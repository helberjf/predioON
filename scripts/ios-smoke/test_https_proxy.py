import contextlib
import errno
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import io
import os
from pathlib import Path
import shutil
import socket
import socketserver
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


def ios_auth_runner():
    # The Android harness has a different run_auth.py. Certificate helpers
    # can place its directory first in sys.path during the same test process.
    spec = importlib.util.spec_from_file_location("ios_proxy_journal_contract", Path(__file__).with_name("run_auth.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class LoopbackFixtureHTTPServer(ThreadingHTTPServer):
    def server_bind(self):
        # HTTPServer resolves a reverse DNS name between bind and listen.
        # This numeric loopback fixture must start independently of DNS.
        socketserver.TCPServer.server_bind(self)
        self.server_name = "localhost"
        self.server_port = self.server_address[1]


class ReadinessTests(unittest.TestCase):
    def test_real_password_proxy_process_has_verified_health_and_closed_startup_journal(self):
        run_auth = ios_auth_runner()
        if sys.platform == "darwin":
            binary = Path(subprocess.check_output(["brew", "--prefix", "openssl@3"], text=True).strip()) / "bin/openssl"
        else:
            selected = shutil.which("openssl")
            if not selected:
                self.skipTest("OpenSSL is unavailable for real proxy process TLS")
            binary = Path(selected)
        tool = choose_openssl(binary)
        class Health(BaseHTTPRequestHandler):
            observed = []
            def do_GET(self):
                self.observed.append((self.command, self.path))
                body = b'{"ok":true,"service":"predioon-api","timestamp":"2026-10-04T00:00:00Z"}'
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            def log_message(self, *_): pass
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ca = create_ios_certificates(root / "tls", tool)
            with LoopbackFixtureHTTPServer(("127.0.0.1", 0), Health) as upstream:
                thread = threading.Thread(target=upstream.serve_forever, daemon=True)
                thread.start()
                with (root / "proxy.log").open("w") as log:
                    process = subprocess.Popen([sys.executable, "-B", str(Path(__file__).resolve().parents[1] / "android-password-smoke/password_proxy.py"),
                        "--tls", str(root / "tls"), "--upstream-port", str(upstream.server_port)], stdout=log, stderr=log)
                    diagnostics = readiness.ProbeDiagnostics()
                    try:
                        readiness.wait_for_proxy(ca, lambda: process.poll() is None, budget=3, interval=.05, diagnostics=diagnostics)
                        self.assertEqual(readiness.proxy_startup_stage(root), "serving")
                        self.assertEqual(diagnostics.snapshot()["lastProbe"], {"stage": "body", "outcome": "ready", "errno": "none"})
                        self.assertEqual(Health.observed, [("GET", "/health")])
                        # The proxy writes its journal after the response body.
                        # Observe that same GET, without sending another one.
                        journal_deadline = time.monotonic() + .5
                        while not run_auth.proxy_events(root / "proxy.log") and time.monotonic() < journal_deadline:
                            time.sleep(.01)
                        self.assertEqual(run_auth.proxy_events(root / "proxy.log"), [{"method": "GET", "path": "/health", "status": 200}])
                    finally:
                        process.terminate()
                        process.wait(timeout=3)
                        upstream.shutdown()
                        thread.join(timeout=3)

    def test_probe_diagnostics_only_expose_closed_stages_and_errno_categories(self):
        for phase, error, outcome, errno_category in [
            ("tcp", ConnectionRefusedError(errno.ECONNREFUSED, SECRET), "io-retry", "refused"),
            ("tls", ssl.SSLCertVerificationError(SECRET), "tls-rejected", "other"),
            (SECRET, OSError(SECRET), "io-retry", "other"),
        ]:
            diagnostics = readiness.ProbeDiagnostics()
            with patch.object(readiness, "DeadlineHTTPSConnection") as connection:
                def failed_request(*_args):
                    connection.return_value.phase = phase
                    raise error
                connection.return_value.request.side_effect = failed_request
                if outcome == "tls-rejected":
                    with self.assertRaisesRegex(readiness.ReadinessFailure, "proxy_tls_rejected"):
                        readiness.probe(object(), .1, diagnostics)
                else:
                    self.assertFalse(readiness.probe(object(), .1, diagnostics))
            snapshot = diagnostics.snapshot()
            self.assertEqual(snapshot, {"attempts": 1, "lastProbe": {
                "stage": phase if phase != SECRET else "unknown", "outcome": outcome, "errno": errno_category}})
            self.assertNotIn(SECRET, str(snapshot))

    def test_http_diagnostics_distinguish_headers_and_body_without_private_values(self):
        for response_status, error, body, stage, outcome, category in [
            (503, None, None, "headers", "http-retry", None),
            (200, http.client.BadStatusLine(SECRET), None, "headers", "http-rejected", "proxy_http_rejected"),
            (200, None, SECRET.encode(), "body", "health-rejected", "proxy_health_rejected"),
        ]:
            diagnostics = readiness.ProbeDiagnostics()
            with patch.object(readiness, "DeadlineHTTPSConnection") as connection:
                response = connection.return_value.getresponse.return_value
                response.status = response_status
                response.read.return_value = body
                if error:
                    connection.return_value.getresponse.side_effect = error
                if category:
                    with self.assertRaisesRegex(readiness.ReadinessFailure, category):
                        readiness.probe(object(), .1, diagnostics)
                else:
                    self.assertFalse(readiness.probe(object(), .1, diagnostics))
            snapshot = diagnostics.snapshot()
            self.assertEqual(snapshot, {"attempts": 1, "lastProbe": {"stage": stage, "outcome": outcome, "errno": "none"}})
            self.assertNotIn(SECRET, str(snapshot))

    def test_startup_diagnostic_only_reads_bounded_regular_log_and_closed_markers(self):
        run_auth = ios_auth_runner()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            log = root / "proxy.log"
            log.write_text("PROXY_STARTUP:bind\n" + SECRET + "\nPROXY_STARTUP:serving\n" +
                           '{"method":"GET","path":"/health","status":200}\nPROXY_STARTUP:' + SECRET + '\n')
            self.assertEqual(readiness.proxy_startup_stage(root), "serving")
            self.assertEqual(run_auth.proxy_events(log), [{"method": "GET", "path": "/health", "status": 200}])
            log.write_text("PROXY_STARTUP:" + SECRET)
            self.assertEqual(readiness.proxy_startup_stage(root), "unknown")
            log.write_bytes(b'x' * (1_048_576 + 1))
            self.assertEqual(readiness.proxy_startup_stage(root), "unavailable")
            log.unlink()
            log.mkdir()
            self.assertEqual(readiness.proxy_startup_stage(root), "unavailable")

    def test_startup_diagnostic_refuses_fifo_and_symlink_without_waiting(self):
        if not hasattr(os, "mkfifo") or not hasattr(os, "O_NOFOLLOW"):
            self.skipTest("POSIX FIFO and no-follow are unavailable")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            log = root / "proxy.log"
            os.mkfifo(log)
            started = time.monotonic()
            self.assertEqual(readiness.proxy_startup_stage(root), "unavailable")
            self.assertLess(time.monotonic() - started, .5)
            log.unlink()
            target = root / "private.txt"
            target.write_text("PROXY_STARTUP:serving\n" + SECRET)
            log.symlink_to(target)
            self.assertEqual(readiness.proxy_startup_stage(root), "unavailable")
            with patch.object(Path, "is_symlink", return_value=False):
                self.assertEqual(readiness.proxy_startup_stage(root), "unavailable")

    def test_cli_diagnostics_never_emit_unrecognized_exception_category(self):
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "proxy.pid").write_text(str(os.getpid()))
            with patch.object(readiness, "disposable_path", return_value=root), \
                 patch.object(readiness, "wait_for_proxy", side_effect=readiness.ReadinessFailure(SECRET)), \
                 contextlib.redirect_stdout(output):
                self.assertEqual(readiness.main(["--private", str(root)]), 1)
        self.assertNotIn(SECRET, output.getvalue())
        self.assertNotIn(str(root), output.getvalue())
        self.assertIn("proxy_configuration_rejected", output.getvalue())

    def test_loopback_fixture_never_uses_reverse_dns_before_listening(self):
        with patch.object(socket, "getfqdn", side_effect=AssertionError("Loopback fixture must not wait for reverse DNS")) as reverse, \
             patch.object(socket.socket, "getsockopt", side_effect=OSError(42, "Protocol not available")) as unsupported:
            with LoopbackFixtureHTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler) as server:
                self.assertEqual(server.server_name, "localhost")
                self.assertEqual(server.server_port, server.server_address[1])
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as client:
                    client.settimeout(.5)
                    client.connect(server.server_address)
            reverse.assert_not_called()
            unsupported.assert_not_called()

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

    def test_real_partial_status_ended_by_watchdog_is_deadline_not_framing(self):
        if sys.platform == "darwin":
            binary = Path(subprocess.check_output(["brew", "--prefix", "openssl@3"], text=True).strip()) / "bin/openssl"
        else:
            selected = shutil.which("openssl")
            if not selected:
                self.skipTest("OpenSSL is unavailable for partial HTTP status TLS")
            binary = Path(selected)
        tool = choose_openssl(binary)
        class PartialStatus(BaseHTTPRequestHandler):
            observed = []
            def do_GET(self):
                self.observed.append((self.command, self.path))
                try:
                    for value in b"HTTP/1.1 200 OK\r\nContent-Length: 36\r\n\r\n":
                        self.wfile.write(bytes([value])); self.wfile.flush(); time.sleep(.04)
                except OSError:
                    pass
            def log_message(self, *_): pass
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ca = create_ios_certificates(root / "tls", tool)
            with LoopbackFixtureHTTPServer(("127.0.0.1", 3443), PartialStatus) as server:
                context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                context.load_cert_chain(root / "tls/server.pem", root / "tls/server.key")
                server.socket = context.wrap_socket(server.socket, server_side=True)
                thread = threading.Thread(target=lambda: server.serve_forever(poll_interval=.02), daemon=True)
                thread.start()
                diagnostics = readiness.ProbeDiagnostics()
                started = time.monotonic()
                try:
                    with self.assertRaisesRegex(readiness.ReadinessFailure, "proxy_readiness_timeout"):
                        readiness.wait_for_proxy(ca, lambda: True, budget=.2, interval=.05, diagnostics=diagnostics)
                    self.assertLess(time.monotonic() - started, .8)
                    self.assertEqual(PartialStatus.observed, [("GET", "/health")])
                    self.assertEqual(diagnostics.snapshot()["lastProbe"], {"stage": "headers", "outcome": "deadline", "errno": "none"})
                finally:
                    server.shutdown()
                    thread.join(timeout=3)

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
                server = LoopbackFixtureHTTPServer(("127.0.0.1", 3443), Handler)
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
