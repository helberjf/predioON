import contextlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import os
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import wait_https_proxy as readiness
from prepare_auth import choose_openssl, create_ios_certificates

SECRET = "SENTINEL_PRIVATE_PROXY_PASSWORD"


class ReadinessTests(unittest.TestCase):
    def test_delayed_readiness_is_bounded_without_mutating_retry(self):
        instant = [0.0]
        calls = []
        def exchange(timeout):
            calls.append(timeout)
            return len(calls) == 3
        with patch.object(readiness.ssl, "create_default_context"):
            readiness.wait_for_proxy("private-ca", lambda: True, budget=1, interval=.2,
                exchange=exchange, clock=lambda: instant[0], sleep=lambda seconds: instant.__setitem__(0, instant[0] + seconds))
        self.assertEqual(len(calls), 3)
        self.assertTrue(all(0 < value <= 1 for value in calls))

    def test_process_exit_and_deadline_fail_closed_without_printing_private_details(self):
        instant = [0.0]
        with patch.object(readiness.ssl, "create_default_context"):
            with self.assertRaisesRegex(readiness.ReadinessFailure, "proxy_process_exited"):
                readiness.wait_for_proxy("private-ca", lambda: False, exchange=lambda _: self.fail("No GET after process exit"))
            with self.assertRaisesRegex(readiness.ReadinessFailure, "proxy_readiness_timeout"):
                readiness.wait_for_proxy("private-ca", lambda: True, budget=.5, interval=.2,
                    exchange=lambda _: False, clock=lambda: instant[0], sleep=lambda seconds: instant.__setitem__(0, instant[0] + seconds))
        self.assertEqual(instant[0], .5)

    def test_only_fixed_get_and_tls_verification_are_used(self):
        class Response:
            status = 200
            def read(self, maximum):
                self.maximum = maximum
                return b'{"ok":true,"service":"predioon-api"}'
        response = Response()
        with patch.object(readiness, "DeadlineHTTPSConnection") as build, patch.object(readiness.ssl, "create_default_context") as context:
            build.return_value.getresponse.return_value = response
            readiness.wait_for_proxy("owned-private-ca", lambda: True)
            context.assert_called_once_with(cafile="owned-private-ca")
            self.assertEqual(build.call_args.args, ("127.0.0.1", 3443))
            self.assertIs(build.call_args.kwargs["context"], context.return_value)
            build.return_value.request.assert_called_once_with("GET", "/health")
            self.assertEqual(response.maximum, 4097)
            build.return_value.close.assert_called_once()

    def test_tls_redirect_and_invalid_health_are_terminal(self):
        for failure, category in [(ssl.SSLCertVerificationError(SECRET), "proxy_tls_rejected")]:
            with patch.object(readiness, "DeadlineHTTPSConnection") as build, patch.object(readiness.ssl, "create_default_context"):
                build.return_value.request.side_effect = failure
                with self.assertRaisesRegex(readiness.ReadinessFailure, category) as error:
                    readiness.wait_for_proxy("private-ca", lambda: True)
                self.assertNotIn(SECRET, str(error.exception))
                self.assertEqual(build.return_value.request.call_count, 1)
        class Response:
            status = 200
            def read(self, _): return self.body
        for body in [SECRET.encode(), b'{"ok":false,"service":"predioon-api"}', b'{"ok":true,"service":"foreign"}', b'x' * 4097, b'[' * 1500 + b'0' + b']' * 1500]:
            response = Response(); response.body = body
            with patch.object(readiness, "DeadlineHTTPSConnection") as build, patch.object(readiness.ssl, "create_default_context"):
                build.return_value.getresponse.return_value = response
                with self.assertRaisesRegex(readiness.ReadinessFailure, "proxy_health_rejected"):
                    readiness.wait_for_proxy("private-ca", lambda: True)
                self.assertEqual(build.return_value.request.call_count, 1)
        response = Response(); response.status = 302
        with patch.object(readiness, "DeadlineHTTPSConnection") as build, patch.object(readiness.ssl, "create_default_context"):
            build.return_value.getresponse.return_value = response
            with self.assertRaisesRegex(readiness.ReadinessFailure, "proxy_http_rejected"):
                readiness.wait_for_proxy("private-ca", lambda: True)
            build.return_value.request.assert_called_once_with("GET", "/health")

    def test_malformed_http_framing_stays_private_and_fails_within_budget(self):
        for failure in [http.client.BadStatusLine(SECRET), http.client.UnknownProtocol(SECRET), http.client.LineTooLong(SECRET)]:
            with patch.object(readiness, "DeadlineHTTPSConnection") as build, patch.object(readiness.ssl, "create_default_context"):
                build.return_value.getresponse.side_effect = failure
                with self.assertRaisesRegex(readiness.ReadinessFailure, "proxy_http_rejected") as error:
                    readiness.wait_for_proxy("private-ca", lambda: True, budget=.1, interval=.1)
                self.assertNotIn(SECRET, str(error.exception))
                build.return_value.request.assert_called_once_with("GET", "/health")
                build.return_value.close.assert_called_once()

    def test_success_after_deadline_or_process_exit_is_never_accepted(self):
        instant = [0.0]
        active = [True]
        def late(_timeout):
            instant[0] = 2
            return True
        def exited(_timeout):
            active[0] = False
            return True
        with patch.object(readiness.ssl, "create_default_context"):
            with self.assertRaisesRegex(readiness.ReadinessFailure, "proxy_readiness_timeout"):
                readiness.wait_for_proxy("private-ca", lambda: True, budget=1, exchange=late, clock=lambda: instant[0])
            with self.assertRaisesRegex(readiness.ReadinessFailure, "proxy_process_exited"):
                readiness.wait_for_proxy("private-ca", lambda: active[0], exchange=exited)

    def test_cli_rejection_never_echoes_arguments_or_a_traceback(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(readiness.main([SECRET]), 1)
        self.assertNotIn(SECRET, output.getvalue())
        self.assertNotIn("Traceback", output.getvalue())
        self.assertIn("proxy_configuration_rejected", output.getvalue())

    def test_cli_pid_must_be_a_bounded_regular_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            pid = root / "proxy.pid"
            for contents in [SECRET, "0", "-1", "2147483648", "1" * 40]:
                pid.write_text(contents)
                output = io.StringIO()
                with patch.object(readiness, "disposable_path", return_value=root), patch.object(readiness, "wait_for_proxy") as wait, contextlib.redirect_stdout(output):
                    self.assertEqual(readiness.main(["--private", str(root)]), 1)
                    wait.assert_not_called()
                self.assertNotIn(SECRET, output.getvalue())
                self.assertNotIn(str(root), output.getvalue())
            pid.unlink()
            if hasattr(os, "mkfifo"):
                os.mkfifo(pid)
                with patch.object(readiness, "disposable_path", return_value=root), contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(readiness.main(["--private", str(root)]), 1)
                pid.unlink()
            pid.write_text(str(os.getpid()))
            with patch.object(readiness, "disposable_path", return_value=root), patch.object(readiness, "wait_for_proxy") as wait, patch.object(readiness.os, "kill") as signal, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(readiness.main(["--private", str(root)]), 0)
                self.assertEqual(wait.call_args.args[0], root / "tls/ca.pem")
                self.assertEqual(wait.call_args.args[1](), sys.platform != "win32")
                if sys.platform == "win32":
                    signal.assert_not_called()
                else:
                    signal.assert_called_once_with(os.getpid(), 0)

    def test_workflow_waits_for_proxy_before_xctest(self):
        workflow = (Path(__file__).resolve().parents[2] / ".github/workflows/ios-auth.yml").read_text()
        self.assertIn('python3 -B scripts/ios-smoke/wait_https_proxy.py --private "$IOS_AUTH_PRIVATE"', workflow)
        self.assertNotIn('curl --fail --cacert "$IOS_AUTH_PRIVATE/tls/ca.pem"', workflow)

    def test_real_delayed_https_startup_and_wrong_ca(self):
        if sys.platform == "darwin":
            binary = Path(subprocess.check_output(["brew", "--prefix", "openssl@3"], text=True).strip()) / "bin/openssl"
        else:
            selected = shutil.which("openssl")
            if sys.platform == "win32" and not selected:
                self.skipTest("OpenSSL is not installed in Windows")
            self.assertIsNotNone(selected)
            binary = Path(selected)
        tool = choose_openssl(binary)
        class Handler(BaseHTTPRequestHandler):
            requests = []
            trickle = False
            def do_GET(self):
                self.requests.append((self.command, self.path))
                body = b'{"ok":true,"service":"predioon-api"}'
                self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers()
                if self.trickle:
                    try:
                        for value in body:
                            self.wfile.write(bytes([value])); self.wfile.flush(); time.sleep(.04)
                    except OSError:
                        pass
                else:
                    self.wfile.write(body)
            def log_message(self, *_): pass
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ca = create_ios_certificates(root / "tls", tool)
            other_ca = create_ios_certificates(root / "other", tool)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(root / "tls/server.pem", root / "tls/server.key")
            holder = []
            def start():
                time.sleep(.3)
                server = ThreadingHTTPServer(("127.0.0.1", 3443), Handler)
                server.socket = context.wrap_socket(server.socket, server_side=True)
                holder.append(server)
                server.serve_forever(poll_interval=.02)
            thread = threading.Thread(target=start, daemon=True); thread.start()
            try:
                with socket.socket() as initial:
                    self.assertNotEqual(initial.connect_ex(("127.0.0.1", 3443)), 0, "Fixture must begin before listening")
                readiness.wait_for_proxy(ca, lambda: True, budget=3, interval=.05)
                self.assertEqual(Handler.requests, [("GET", "/health")])
                Handler.trickle = True
                started = time.monotonic()
                with self.assertRaisesRegex(readiness.ReadinessFailure, "proxy_readiness_timeout"):
                    readiness.wait_for_proxy(ca, lambda: True, budget=.2, interval=.05)
                self.assertLess(time.monotonic() - started, .8, "A trickling body must not extend the overall deadline")
                self.assertEqual(Handler.requests, [("GET", "/health"), ("GET", "/health")])
                with self.assertRaisesRegex(readiness.ReadinessFailure, "proxy_tls_rejected"):
                    readiness.wait_for_proxy(other_ca, lambda: True, budget=3)
                self.assertEqual(Handler.requests, [("GET", "/health"), ("GET", "/health")])
            finally:
                if holder: holder[0].shutdown(); holder[0].server_close()
                thread.join(timeout=4)
            # A TCP peer which accepts but never replies to ClientHello must
            # obey the same whole-probe deadline as slow headers/body.
            pending = []
            with socket.socket() as raw:
                raw.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                raw.bind(("127.0.0.1", 3443)); raw.listen(); raw.settimeout(2)
                def hold_handshake():
                    peer, _address = raw.accept(); pending.append(peer)
                    peer.recv(4096)
                stalled = threading.Thread(target=hold_handshake, daemon=True); stalled.start()
                started = time.monotonic()
                try:
                    with self.assertRaisesRegex(readiness.ReadinessFailure, "proxy_readiness_timeout"):
                        readiness.wait_for_proxy(ca, lambda: True, budget=.2, interval=.05)
                    self.assertLess(time.monotonic() - started, .8)
                finally:
                    for peer in pending: peer.close()
                    stalled.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
