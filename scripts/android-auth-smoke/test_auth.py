import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import socket
import ssl
import tempfile
import threading
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

from tls import NETWORK_CONFIG, configure_manifest, create_certificates
from proxy import make_handler
from run_auth import APPS, AuthDevice, expected_session, inspect_profile, redact, run, verify_sessions


def fixture():
    return {"accounts": {app: {"name": f"Person {app}", "email": f"{app}@test.invalid",
                               "buildingName": f"Building {app}", "productTitle": f"Product {app}"} for app in APPS}}


def profile(app):
    root = ET.Element("hierarchy")
    labels = list(fixture()["accounts"][app].values()) + ["Escolha o condomínio", "Sair"]
    for label in labels:
        ET.SubElement(root, "node", {"package": APPS[app][0], "class": "android.widget.Button" if label == "Sair" else "android.widget.TextView", "text": label})
    return ET.tostring(root, encoding="unicode")


class AuthAssertions(unittest.TestCase):
    def test_profile_requires_correct_product_identity_and_tenant(self):
        for app in APPS:
            inspect_profile(profile(app), app, fixture())
            for label in fixture()["accounts"][app].values():
                with self.assertRaises(AssertionError):
                    inspect_profile(profile(app).replace(label, "wrong"), app, fixture())
            other = next(value for value in APPS if value != app)
            with self.assertRaises(AssertionError):
                inspect_profile(profile(other), app, fixture())

    def test_neighbor_identity_even_on_correct_profile_is_rejected(self):
        app = "resident-mobile"
        root = ET.fromstring(profile(app))
        ET.SubElement(root, "node", {"package": APPS[app][0], "text": fixture()["accounts"]["operations-mobile"]["email"]})
        with self.assertRaisesRegex(AssertionError, "Another product"):
            inspect_profile(ET.tostring(root, encoding="unicode"), app, fixture())

    def test_rotation_and_logout_are_proved_by_database_metadata(self):
        expected = {app: "restored" for app in APPS}
        wrong = {app: expected_session("login") for app in APPS}
        with tempfile.TemporaryDirectory() as directory:
            with patch("run_auth.database_snapshot", return_value=wrong), patch("run_auth.time.monotonic", side_effect=[0, 31]):
                with self.assertRaisesRegex(AssertionError, "Session state"):
                    verify_sessions(Path("fixture.json"), expected, Path(directory), "restore")
            actual = {app: expected_session("restored") for app in APPS}
            with patch("run_auth.database_snapshot", return_value=actual):
                verify_sessions(Path("fixture.json"), expected, Path(directory), "restore")
            self.assertEqual(json.loads((Path(directory) / "sessions-restore.json").read_text()), actual)
            self.assertEqual(expected_session("final-logout")["active_sessions"], 0)
            self.assertEqual(expected_session("final-logout")["logouts"], 2)

    def test_physical_device_is_refused_before_installing_any_app(self):
        class Physical:
            calls = []
            def adb(self, *args):
                self.calls.append(args)
                return "0"
        device = Physical()
        with self.assertRaisesRegex(AssertionError, "disposable emulator"):
            run([device, object()], Path("unused"), Path("unused"), Path("unused"))
        self.assertEqual(device.calls, [("shell", "getprop", "ro.kernel.qemu")])

    def test_evidence_redacts_password_jwt_and_opaque_refresh_token(self):
        password = "ExamplePassword123456"
        jwt = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ0ZXN0LWFjY291bnQifQ." + "sig" * 24
        refresh = "aBcD1234" * 8
        source = f"password={password} bearer={jwt} refresh={refresh} harmless status=200"
        result = redact(source, password)
        for secret in [password, jwt, refresh]:
            self.assertNotIn(secret, result)
        self.assertIn("status=200", result)

    def test_exposed_credentials_never_produce_phase_or_final_screenshots(self):
        password = "ExamplePassword123456"
        jwt = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ0ZXN0LWFjY291bnQifQ." + "sig" * 24
        for secret in [password, jwt, "aBcD1234" * 8]:
            with self.subTest(secret_kind="password" if secret == password else "token"), tempfile.TemporaryDirectory() as directory:
                device = AuthDevice("unused", "resident-mobile", Path(directory), fixture(), password)
                device.last_adb_failure = {"stdout": secret, "stderr": secret, "exitCode": 1}
                source = profile("resident-mobile").replace("</hierarchy>", f'<node text="{secret}" /></hierarchy>')
                with patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", return_value=source), patch.object(device, "screen") as screenshot:
                    with patch("run_auth.time.monotonic", side_effect=[0, 0, 61]), patch("run_auth.time.sleep"):
                        with self.assertRaisesRegex(AssertionError, "Credentials leaked"):
                            device.wait_for("unsafe", lambda _source: None)
                    self.assertFalse((Path(directory) / "unsafe.xml").exists())
                    with patch.object(device, "adb", return_value=source):
                        device.collect()
                    screenshot.assert_not_called()
                    for artifact in Path(directory).iterdir():
                        self.assertNotIn(secret, artifact.read_text(encoding="utf-8"))


class TrustAssertions(unittest.TestCase):
    def test_apk_policy_trusts_only_ephemeral_ca_and_forbids_cleartext(self):
        root = ET.fromstring(NETWORK_CONFIG)
        self.assertEqual(root.find("base-config").get("cleartextTrafficPermitted"), "false")
        self.assertEqual([node.get("src") for node in root.iter("certificates")], ["@raw/ci_auth_ca"])
        original = '<manifest><application android:allowBackup="false"></application></manifest>'
        self.assertIn('android:networkSecurityConfig="@xml/ci_auth_network"', configure_manifest(original))
        self.assertIn('android:allowBackup="false"', configure_manifest(original))
        for unexpected in ["", original + original, configure_manifest(original)]:
            with self.assertRaises(ValueError):
                configure_manifest(unexpected)

    @unittest.skipUnless(shutil.which("openssl"), "OpenSSL executable is required for real TLS verification")
    def test_real_https_proxy_requires_trusted_ca_and_correct_hostname(self):
        class Upstream(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"ok":true}')
            def log_message(self, *_args):
                pass
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            ca = create_certificates(path / "tls")
            with self.assertRaises(ValueError):
                create_certificates(path / "tls")
            upstream = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
            server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(upstream.server_port))
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(path / "tls/server.pem", path / "tls/server.key")
            server.socket = context.wrap_socket(server.socket, server_side=True)
            for service in [upstream, server]:
                threading.Thread(target=service.serve_forever, daemon=True).start()
            try:
                trusted = ssl.create_default_context(cafile=str(ca))
                connection = http.client.HTTPSConnection("127.0.0.1", server.server_port, context=trusted)
                connection.request("GET", "/health")
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.read()), {"ok": True})
                connection.close()
                for context, hostname in [(ssl.create_default_context(), "127.0.0.1"), (trusted, "localhost")]:
                    with socket.create_connection(("127.0.0.1", server.server_port)) as raw:
                        with self.assertRaises(ssl.SSLCertVerificationError):
                            context.wrap_socket(raw, server_hostname=hostname)
                connection = http.client.HTTPSConnection("127.0.0.1", server.server_port, context=trusted)
                connection.request("GET", "/access/gate/open")
                response = connection.getresponse()
                self.assertEqual(response.status, 403)
                response.read()
                connection.close()
            finally:
                for service in [server, upstream]:
                    service.shutdown()
                    service.server_close()


if __name__ == "__main__":
    unittest.main()
