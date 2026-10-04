import contextlib
import http.client
from http.server import BaseHTTPRequestHandler
import io
import json
from pathlib import Path
import shutil
import socket
import ssl
import tempfile
import threading
import unittest
from unittest.mock import patch

import proxy
from tls import create_certificates


class LoopbackStartupTests(unittest.TestCase):
    def test_real_loopback_proxy_preserves_tls_ca_forwarding_and_allowlist(self):
        if not shutil.which('openssl'):
            self.skipTest('OpenSSL is unavailable for real proxy TLS')
        class Upstream(BaseHTTPRequestHandler):
            observed = []
            def do_GET(self):
                self.observed.append(self.path)
                body = b'{"ok":true,"service":"predioon-api"}'
                self.send_response(200)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            def log_message(self, *_): pass
        with tempfile.TemporaryDirectory() as temporary:
            tls = Path(temporary)
            ca = create_certificates(tls / 'trusted')
            other_ca = create_certificates(tls / 'other')
            with proxy.LoopbackHTTPServer(('127.0.0.1', 0), Upstream) as upstream, \
                 proxy.LoopbackHTTPServer(('127.0.0.1', 0), proxy.make_handler(upstream.server_port)) as server:
                context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                context.load_cert_chain(tls / 'trusted/server.pem', tls / 'trusted/server.key')
                server.socket = context.wrap_socket(server.socket, server_side=True)
                threads = [threading.Thread(target=item.serve_forever, daemon=True) for item in [upstream, server]]
                for thread in threads: thread.start()
                try:
                    connection = http.client.HTTPSConnection('127.0.0.1', server.server_port,
                        context=ssl.create_default_context(cafile=str(ca)), timeout=3)
                    try:
                        with contextlib.redirect_stdout(io.StringIO()):
                            connection.request('GET', '/health')
                            response = connection.getresponse()
                            self.assertEqual(response.status, 200)
                            self.assertEqual(json.loads(response.read()), {'ok': True, 'service': 'predioon-api'})
                        connection.request('GET', '/alerts')
                        response = connection.getresponse()
                        self.assertEqual(response.status, 403)
                        response.read()
                    finally:
                        connection.close()
                    rejected = http.client.HTTPSConnection('127.0.0.1', server.server_port,
                        context=ssl.create_default_context(cafile=str(other_ca)), timeout=3)
                    try:
                        with self.assertRaises(ssl.SSLCertVerificationError):
                            rejected.request('GET', '/health')
                    finally:
                        rejected.close()
                    self.assertEqual(Upstream.observed, ['/health'])
                finally:
                    server.shutdown()
                    upstream.shutdown()
                    for thread in threads: thread.join(timeout=3)

    def test_bind_and_listen_do_not_use_reverse_dns_or_platform_socket_option(self):
        with patch.object(socket, 'getfqdn', side_effect=AssertionError('Numeric loopback must not depend on reverse DNS')) as reverse, \
             patch.object(socket.socket, 'getsockopt', side_effect=OSError(42, 'Protocol not available')) as option:
            with proxy.LoopbackHTTPServer(('127.0.0.1', 0), BaseHTTPRequestHandler) as server:
                self.assertEqual(server.server_name, 'localhost')
                self.assertEqual(server.server_port, server.server_address[1])
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as client:
                    client.settimeout(.5)
                    client.connect(server.server_address)
            reverse.assert_not_called()
            option.assert_not_called()

    def test_startup_markers_are_closed_and_cannot_be_auth_journal_events(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            proxy.emit_startup('bind')
            proxy.emit_startup('listening')
            with self.assertRaises(ValueError):
                proxy.emit_startup('SENTINEL_PRIVATE_STARTUP_PASSWORD')
        self.assertEqual(output.getvalue().splitlines(), ['PROXY_STARTUP:bind', 'PROXY_STARTUP:listening'])
        self.assertTrue(all(not line.startswith('{') for line in output.getvalue().splitlines()))


if __name__ == '__main__':
    unittest.main()
