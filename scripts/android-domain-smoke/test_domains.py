import unittest
import xml.etree.ElementTree as ET
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import ssl
import tempfile
import threading
from unittest.mock import patch

from assertions import PrivacyViolation, allows, inspect_domain, action_node, assert_snapshot
from run_domains import DomainDevice, run
from proxy import make_handler
from tls import create_certificates

PACKAGE = "com.predioon.operations"
BUILDING = "Condominio Operacao CI"


def page(*labels, button=None, enabled="true"):
    root = ET.Element("hierarchy")
    for label in [BUILDING, *labels]:
        ET.SubElement(root, "node", {"package": PACKAGE, "class": "android.widget.TextView", "text": label})
    if button:
        ET.SubElement(root, "node", {"package": PACKAGE, "class": "android.widget.Button", "text": button,
                                    "enabled": enabled, "clickable": "true", "bounds": "[10,20][100,70]"})
    return ET.tostring(root, encoding="unicode")


class DomainAssertions(unittest.TestCase):
    @unittest.skipUnless(shutil.which("openssl"), "OpenSSL is required for the actual TLS transport")
    def test_real_tls_default_rejects_patch_and_domain_forwards_only_allowed_patch(self):
        seen = []
        class Upstream(BaseHTTPRequestHandler):
            def do_PATCH(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                seen.append((self.command, self.path, body, self.headers.get("Content-Type")))
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"forwarded":true}')
            def log_message(self, *_args):
                pass
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            ca = create_certificates(path / "tls")
            upstream = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
            auth = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(upstream.server_port))
            domains = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(upstream.server_port, allows))
            for server in [auth, domains]:
                context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                context.load_cert_chain(path / "tls/server.pem", path / "tls/server.key")
                server.socket = context.wrap_socket(server.socket, server_side=True)
            services = [upstream, auth, domains]
            for server in services:
                threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                trusted = ssl.create_default_context(cafile=str(ca))
                target = "/occurrences/11111111-1111-4111-8111-111111111111"
                body = b'{"status":"IN_PROGRESS"}'
                def request(server, method, route):
                    connection = http.client.HTTPSConnection("127.0.0.1", server.server_port, context=trusted)
                    try:
                        connection.request(method, route, body=body, headers={"Content-Type": "application/json"})
                        response = connection.getresponse()
                        return response.status, response.read()
                    finally:
                        connection.close()
                self.assertEqual(request(auth, "PATCH", target)[0], 403)
                self.assertEqual(seen, [])
                status, response = request(domains, "PATCH", target)
                self.assertEqual(status, 200)
                self.assertEqual(json.loads(response), {"forwarded": True})
                for server in [auth, domains]:
                    self.assertEqual(request(server, "POST", "/access/commands")[0], 403)
                self.assertEqual(seen, [("PATCH", target, body, "application/json")])
            finally:
                for server in reversed(services):
                    server.shutdown()
                    server.server_close()

    def test_private_content_is_terminal_even_before_the_expected_screen_arrives(self):
        with self.assertRaises(PrivacyViolation):
            inspect_domain(page("PRIVATE"), PACKAGE, BUILDING, ["Loading is finished"], ["PRIVATE"])
        fixture = {"forbidden": ["PRIVATE"], "accounts": {"operations-mobile": {"buildingName": BUILDING}}}
        with tempfile.TemporaryDirectory() as output:
            device = DomainDevice("unused", "operations-mobile", Path(output), fixture, "FixturePassword123")
            with patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", side_effect=[page("PRIVATE"), page("Allowed")]) as observe, patch.object(device, "screen") as capture:
                with self.assertRaisesRegex(RuntimeError, "Private neighbor"):
                    device.wait_domain("privacy", ["Allowed"])
                self.assertEqual(observe.call_count, 1)
                capture.assert_not_called()
                self.assertEqual(list(Path(output).iterdir()), [])

    def test_physical_devices_are_refused_before_fixture_changes_or_app_install(self):
        class Physical:
            fixture = {"labels": {}}
            calls = []
            def adb(self, *args):
                self.calls.append(args)
                return "0"
        device = Physical()
        with patch("run_domains.fixture_action") as mutate:
            with self.assertRaisesRegex(AssertionError, "disposable emulator"):
                run([device, device], Path("unused"), Path("unused"), Path("unused"))
            self.assertEqual(device.calls, [("shell", "getprop", "ro.kernel.qemu")])
            mutate.assert_not_called()

    def test_proxy_allows_only_the_domain_methods_exercised(self):
        identifier = "11111111-1111-4111-8111-111111111111"
        for method, path in [("GET", "/finance"), ("GET", "/telemetry/latest"),
                             ("GET", "/v1/authorization"), ("GET", "/features/buildings/ci-building"),
                             ("POST", "/occurrences"), ("POST", f"/occurrences/{identifier}/comments"),
                             ("PATCH", f"/occurrences/{identifier}"), ("POST", f"/alerts/{identifier}/acknowledge")]:
            self.assertTrue(allows(method, path), (method, path))
        for method, path in [("POST", "/finance"), ("DELETE", f"/occurrences/{identifier}"),
                             ("POST", "/access/commands"), ("POST", f"/alerts/{identifier}/resolve"),
                             ("GET", "/admin/users"), ("GET", "/occurrences/../auth/me"),
                             ("GET", "https://example.com/finance"), ("GET", "/occurrences/%2e%2e"),
                             ("POST", f"/occurrences/{identifier}/comments/extra")]:
            self.assertFalse(allows(method, path), (method, path))

    def test_page_requires_tenant_and_current_content_and_rejects_private_text(self):
        inspect_domain(page("Allowed"), PACKAGE, BUILDING, ["Allowed"], ["PRIVATE"])
        for source in [page("Wrong"), page("Allowed").replace(BUILDING, "Neighbor building"),
                       page("Allowed", "prefix PRIVATE suffix")]:
            with self.assertRaises(AssertionError):
                inspect_domain(source, PACKAGE, BUILDING, ["Allowed"], ["PRIVATE"])

    def test_button_must_be_unique_enabled_native_action(self):
        nodes = inspect_domain(page("Visible", button="Reconhecer"), PACKAGE, BUILDING, ["Visible"], [])
        self.assertEqual(action_node(nodes, "Reconhecer").get("enabled"), "true")
        for source in [page("Reconhecer"), page("Visible", button="Reconhecer", enabled="false")]:
            with self.assertRaises(AssertionError):
                action_node(inspect_domain(source, PACKAGE, BUILDING, [], []), "Reconhecer")
        with self.assertRaises(AssertionError):
            action_node(nodes + [nodes[-1]], "Reconhecer")

    def test_database_proof_requires_persistence_and_unchanged_neighbors(self):
        snapshot = {"residentCreated": 1, "residentComments": 1, "operatorStatus": "IN_PROGRESS",
                    "operatorComments": 1, "alertStatus": "ACKNOWLEDGED", "neighborStatus": "OPEN",
                    "neighborAlertStatus": "OPEN", "neighborEvents": 0, "deviceGrantActive": False,
                    "ticketGrantActive": False, "financeGrantActive": False}
        assert_snapshot(snapshot, "final")
        for key, value in [("residentCreated", 2), ("residentComments", 0), ("neighborEvents", 1),
                           ("neighborStatus", "DONE"), ("ticketGrantActive", True), ("alertStatus", "OPEN")]:
            with self.assertRaises(AssertionError):
                assert_snapshot({**snapshot, key: value}, "final")


if __name__ == "__main__":
    unittest.main()
