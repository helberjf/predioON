import http.client
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import ssl
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
import xml.etree.ElementTree as ET

from run_password import APPS, PasswordDevice, SecurityViolation, expected_sessions, inspect_account, main, run, sanitize, verify
from password_proxy import PASSWORD_ALLOWED, handler
from tls import create_certificates


OLD = "OldPassword1234567890"
NEW = " New SecretPassword987654321 phrase "


def fixture():
    return {"accounts": {app: {"name": "Person " + app, "email": app + "@test.invalid",
                               "buildingName": "Building " + app, "productTitle": "Product " + app} for app in APPS}}


def account(app="resident-mobile"):
    root = ET.Element("hierarchy")
    for label in list(fixture()["accounts"][app].values()) + ["Trocar minha senha", "Minha conta"]:
        ET.SubElement(root, "node", {"package": APPS[app][0], "class": "android.widget.TextView", "text": label})
    for label in ["Senha atual", "Nova senha", "Confirmar nova senha"]:
        ET.SubElement(root, "node", {"package": APPS[app][0], "class": "android.widget.EditText", "content-desc": label,
                                     "text": "", "password": "true", "enabled": "true", "bounds": "[20,200][400,260]"})
    ET.SubElement(root, "node", {"package": APPS[app][0], "class": "android.widget.Button", "text": "Confirmar troca de senha",
                                 "enabled": "true", "clickable": "true", "bounds": "[20,500][400,560]"})
    return ET.tostring(root, encoding="unicode")


def profile(app="resident-mobile"):
    root = ET.fromstring(account(app))
    for node in list(root):
        if node.get("class") == "android.widget.EditText":
            root.remove(node)
    for label in ["Escolha o condomínio", "Sair"]:
        ET.SubElement(root, "node", {"package": APPS[app][0], "class": "android.widget.Button" if label == "Sair" else "android.widget.TextView", "text": label,
                                     "enabled": "true", "bounds": "[20,200][400,260]"})
    next(node for node in root if node.get("text") == "Minha conta").set("class", "android.widget.Button")
    next(node for node in root if node.get("text") == "Minha conta").set("enabled", "true")
    next(node for node in root if node.get("text") == "Minha conta").set("bounds", "[20,200][400,260]")
    return ET.tostring(root, encoding="unicode")


class PasswordAssertions(unittest.TestCase):
    def test_password_account_checks_own_identity_and_visible_input_security(self):
        for app in APPS:
            inspect_account(account(app), app, fixture())
            for label in ["name", "email", "productTitle"]:
                with self.assertRaises(AssertionError):
                    inspect_account(account(app).replace(fixture()["accounts"][app][label], "wrong"), app, fixture())
            with self.assertRaisesRegex(RuntimeError, "not secure"):
                inspect_account(account(app).replace('password="true"', 'password="false"', 1), app, fixture())

    def test_neighbor_identity_is_a_terminal_failure(self):
        source = account().replace("</hierarchy>", '<node package="com.predioon.resident" text="operations-mobile@test.invalid" /></hierarchy>')
        with self.assertRaisesRegex(RuntimeError, "Another product"):
            inspect_account(source, "resident-mobile", fixture())

    def test_missing_own_labels_cannot_hide_first_observation_security_violation(self):
        missing = account().replace("Person resident-mobile", "missing-own-label")
        unsafe_sources = [
            missing.replace("</hierarchy>", '<node package="com.predioon.resident" text="operations-mobile@test.invalid" /></hierarchy>'),
            missing.replace('password="true"', 'password="false"', 1),
        ]
        for source in unsafe_sources:
            for control in [False, True]:
                with self.subTest(control=control, privacy="operations-mobile@test.invalid" in source), tempfile.TemporaryDirectory() as folder:
                    device = PasswordDevice("unused", "resident-mobile", Path(folder), fixture(), OLD, NEW)
                    device.preflight_passed = True
                    with patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", side_effect=[source, account()]) as hierarchy, patch.object(device, "screen") as screen, patch.object(device, "scroll") as scroll, patch.object(device, "adb") as adb, patch("run_password.time.sleep"):
                        with self.assertRaises(RuntimeError):
                            if control:
                                device.control("Nova senha", field=True)
                            else:
                                device.wait_for("unsafe", lambda value: inspect_account(value, device.app, device.fixture))
                        device.collect()
                        hierarchy.assert_called_once()
                        screen.assert_not_called()
                        scroll.assert_not_called()
                        adb.assert_not_called()
                    self.assertEqual(device.steps, [])
                    self.assertTrue(device.security_failed)
                    self.assertEqual(list(Path(folder).iterdir()), [])

    def test_profile_and_account_entry_reject_peer_identity_before_retrying_missing_own_labels(self):
        unsafe = profile().replace("Person resident-mobile", "missing-own-label").replace("</hierarchy>", '<node package="com.predioon.resident" text="operations-mobile@test.invalid" /></hierarchy>')
        for action in ["profile", "open_account"]:
            with self.subTest(action=action), tempfile.TemporaryDirectory() as folder:
                device = PasswordDevice("unused", "resident-mobile", Path(folder), fixture(), OLD, NEW)
                device.preflight_passed = True
                with patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", side_effect=[unsafe, profile()]) as hierarchy, patch.object(device, "screen") as screen, patch.object(device, "adb") as adb, patch("run_password.time.sleep"):
                    with self.assertRaisesRegex(RuntimeError, "Another product"):
                        getattr(device, action)("unsafe")
                    device.collect()
                    hierarchy.assert_called_once()
                    screen.assert_not_called()
                    adb.assert_not_called()
                self.assertEqual(device.steps, [])
                self.assertEqual(list(Path(folder).iterdir()), [])

    def test_peer_building_alone_is_terminal_before_a_clean_profile_can_be_approved(self):
        unsafe = profile().replace("</hierarchy>", '<node package="com.predioon.resident" text="Building operations-mobile" /></hierarchy>')
        with tempfile.TemporaryDirectory() as folder:
            device = PasswordDevice("unused", "resident-mobile", Path(folder), fixture(), OLD, NEW)
            device.preflight_passed = True
            with patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", side_effect=[unsafe, profile()]) as hierarchy, patch.object(device, "screen") as screen, patch.object(device, "adb") as adb, patch("run_password.time.sleep"):
                with self.assertRaisesRegex(RuntimeError, "Another product"):
                    device.profile("unsafe-peer-building")
                device.collect()
                hierarchy.assert_called_once()
                screen.assert_not_called()
                adb.assert_not_called()
            self.assertEqual(device.steps, [])
            self.assertTrue(device.security_failed)
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_collect_before_preflight_cannot_read_any_device_surface(self):
        with tempfile.TemporaryDirectory() as folder:
            device = PasswordDevice("personal-device", "resident-mobile", Path(folder), fixture(), OLD, NEW)
            with patch.object(device, "adb") as adb, patch.object(device, "hierarchy") as hierarchy, patch.object(device, "screen") as screen:
                device.collect()
                adb.assert_not_called()
                hierarchy.assert_not_called()
                screen.assert_not_called()
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_main_terminal_security_failure_cannot_collect_even_after_preflight(self):
        for failed in [(True, False), (False, True)]:
            with self.subTest(failed=failed), tempfile.TemporaryDirectory() as folder:
                directory = Path(folder)
                fixture_path = directory / "fixture.json"
                fixture_path.write_text(json.dumps(fixture()), encoding="utf-8")
                args = argparse.Namespace(serial="emulator-5554", fixture=fixture_path, apks=directory, artifacts=directory / "evidence")
                devices = [Mock(app=app, steps=[], preflight_passed=True, security_failed=failed[index]) for index, app in enumerate(APPS)]
                with patch("run_password.argparse.ArgumentParser.parse_args", return_value=args), patch("run_password.PasswordDevice", side_effect=devices), patch.dict("run_password.os.environ", {"ANDROID_AUTH_PASSWORD": OLD, "ANDROID_PASSWORD_NEW": NEW}), patch("run_password.run", side_effect=SecurityViolation("Another product identity is visible")):
                    with self.assertRaisesRegex(SystemExit, "Android password journey failed"):
                        main()
                for device in devices:
                    device.collect.assert_not_called()
                    device.adb.assert_not_called()
                result = json.loads((args.artifacts / "result.json").read_text(encoding="utf-8"))
                self.assertFalse(result["passed"])
                self.assertIn("Another product", result["error"])

    def test_main_refuses_physical_device_without_final_diagnostics(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            fixture_path = directory / "fixture.json"
            fixture_path.write_text(json.dumps(fixture()), encoding="utf-8")
            args = argparse.Namespace(serial="personal-device", fixture=fixture_path, apks=directory, artifacts=directory / "evidence")
            devices = [Mock(app=app, steps=[], preflight_passed=False, security_failed=False) for app in APPS]
            devices[0].adb.return_value = "0"
            with patch("run_password.argparse.ArgumentParser.parse_args", return_value=args), patch("run_password.PasswordDevice", side_effect=devices), patch.dict("run_password.os.environ", {"ANDROID_AUTH_PASSWORD": OLD, "ANDROID_PASSWORD_NEW": NEW}), patch("run_password.verify") as snapshot:
                with self.assertRaisesRegex(SystemExit, "Android password journey failed"):
                    main()
            devices[0].adb.assert_called_once_with("shell", "getprop", "ro.kernel.qemu")
            devices[1].adb.assert_not_called()
            snapshot.assert_not_called()
            for device in devices:
                device.collect.assert_not_called()
                device.wait_environment_ready.assert_not_called()
            result = json.loads((args.artifacts / "result.json").read_text(encoding="utf-8"))
            self.assertFalse(result["passed"])
            self.assertIn("disposable emulator", result["error"])

    def test_failed_disposable_database_guard_cannot_read_environment_or_final_device_diagnostics(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            fixture_path = directory / "fixture.json"
            fixture_path.write_text(json.dumps(fixture()), encoding="utf-8")
            args = argparse.Namespace(serial="emulator-5554", fixture=fixture_path, apks=directory, artifacts=directory / "evidence")
            devices = [Mock(app=app, steps=[], preflight_passed=False, security_failed=False) for app in APPS]
            devices[0].adb.return_value = "1"
            with patch("run_password.argparse.ArgumentParser.parse_args", return_value=args), patch("run_password.PasswordDevice", side_effect=devices), patch.dict("run_password.os.environ", {"ANDROID_AUTH_PASSWORD": OLD, "ANDROID_PASSWORD_NEW": NEW}), patch("run_password.verify", side_effect=AssertionError("Disposable loopback database guard failed")):
                with self.assertRaisesRegex(SystemExit, "Android password journey failed"):
                    main()
            self.assertEqual(devices[0].adb.call_count, 2)
            devices[1].adb.assert_not_called()
            for device in devices:
                device.collect.assert_not_called()
                device.wait_environment_ready.assert_not_called()

    def test_physical_device_is_refused_before_install_or_database_operation(self):
        class Physical:
            calls = []
            def adb(self, *args):
                self.calls.append(args)
                return "0"
        device = Physical()
        with patch("run_password.verify") as snapshot:
            with self.assertRaisesRegex(AssertionError, "disposable emulator"):
                run([device, object()], Path("unused"), Path("unused"), Path("unused"))
            snapshot.assert_not_called()
        self.assertEqual(device.calls, [("shell", "getprop", "ro.kernel.qemu")])

    def test_password_revocation_preserves_logout_count_and_peer_session(self):
        states = {"resident-mobile": "changed", "operations-mobile": "login"}
        correct = {app: expected_sessions(state) for app, state in states.items()}
        with tempfile.TemporaryDirectory() as folder:
            destination = Path(folder)
            wrong = {app: expected_sessions("changed") for app in APPS}
            with patch("run_password.database_snapshot", return_value=wrong), patch("run_password.time.monotonic", side_effect=[0, 31]):
                with self.assertRaisesRegex(AssertionError, "session metadata"):
                    verify(Path("fixture.json"), states, destination, "revoked")
            self.assertFalse((destination / "sessions-revoked.json").exists())
            with patch("run_password.database_snapshot", return_value=correct):
                verify(Path("fixture.json"), states, destination, "revoked")
            self.assertEqual(json.loads((destination / "sessions-revoked.json").read_text()), correct)
        self.assertEqual(correct["resident-mobile"]["logouts"], 0)
        self.assertEqual(correct["operations-mobile"]["active_sessions"], 1)

    def test_evidence_sanitizes_old_and_literal_new_password_and_tokens(self):
        jwt = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ0ZXN0LWFjY291bnQifQ." + "sig" * 24
        opaque = "aBcD1234" * 8
        clean = sanitize(f"old={OLD} new={NEW} wrong=DefinitelyWrong123 jwt={jwt} refresh={opaque} status=204", OLD, NEW)
        for secret in [OLD, NEW, "DefinitelyWrong123", jwt, opaque]:
            self.assertNotIn(secret, clean)
        self.assertIn("status=204", clean)

    def test_password_leak_is_terminal_and_cannot_approve_or_capture_a_phase(self):
        for secret in [OLD, NEW, "DefinitelyWrong123"]:
            with self.subTest(secret_kind="new" if secret == NEW else "old-or-invalid"), tempfile.TemporaryDirectory() as folder:
                device = PasswordDevice("unused", "resident-mobile", Path(folder), fixture(), OLD, NEW)
                source = account().replace("</hierarchy>", f'<node text="{secret}" /></hierarchy>')
                with patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", return_value=source) as hierarchy, patch.object(device, "screen") as screen:
                    with self.assertRaisesRegex(RuntimeError, "Credentials leaked"):
                        device.wait_for("unsafe", lambda source: inspect_account(source, device.app, device.fixture))
                    hierarchy.assert_called_once()
                    screen.assert_not_called()
                self.assertEqual(list(Path(folder).iterdir()), [])
                self.assertEqual(device.steps, [])

    def test_transient_hierarchy_failure_is_reobserved_without_replaying_user_action(self):
        with tempfile.TemporaryDirectory() as folder:
            device = PasswordDevice("unused", "resident-mobile", Path(folder), fixture(), OLD, NEW)
            with patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", side_effect=["<malformed", account()]) as hierarchy, patch.object(device, "screen") as screen, patch("run_password.time.sleep"):
                device.wait_for("ready", lambda source: inspect_account(source, device.app, device.fixture))
                self.assertEqual(hierarchy.call_count, 2)
                screen.assert_called_once_with("ready")
            self.assertEqual(device.steps, [{"phase": "ready", "passed": True}])
            self.assertTrue((Path(folder) / "ready.xml").exists())

    def test_final_diagnostics_redact_new_credential_and_omit_screenshot_if_exposed(self):
        with tempfile.TemporaryDirectory() as folder:
            device = PasswordDevice("unused", "resident-mobile", Path(folder), fixture(), OLD, NEW)
            device.preflight_passed = True
            device.last_adb_failure = {"stderr": NEW, "stdout": OLD}
            device.last_hierarchy_output = {"stdout": NEW}
            source = account().replace("</hierarchy>", f'<node text="{NEW}" /></hierarchy>')
            with patch.object(device, "adb", return_value=source), patch.object(device, "hierarchy", return_value=source), patch.object(device, "screen") as screen:
                device.collect()
                screen.assert_not_called()
            for artifact in Path(folder).iterdir():
                self.assertNotIn(OLD, artifact.read_text(encoding="utf-8"))
                self.assertNotIn(NEW, artifact.read_text(encoding="utf-8"))

    @unittest.skipUnless(shutil.which("openssl"), "OpenSSL executable is required for real TLS verification")
    def test_real_tls_proxy_forwards_only_password_post_and_denies_other_credential_or_domain_routes(self):
        received = []
        class Upstream(BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                received.append((self.path, body, self.headers.get("Authorization")))
                self.send_response(204)
                self.end_headers()
            def log_message(self, *_args):
                pass
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            ca = create_certificates(directory / "tls")
            upstream = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler(upstream.server_port))
            tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            tls.load_cert_chain(directory / "tls/server.pem", directory / "tls/server.key")
            server.socket = tls.wrap_socket(server.socket, server_side=True)
            for service in [upstream, server]:
                threading.Thread(target=service.serve_forever, daemon=True).start()
            try:
                trusted = ssl.create_default_context(cafile=str(ca))
                body = json.dumps({"currentPassword": OLD, "newPassword": NEW}).encode()
                for method, path, expected in [("POST", "/auth/password", 204), ("GET", "/auth/password", 403),
                                                ("PATCH", "/auth/password", 403), ("POST", "/access/gate/open", 403),
                                                ("POST", "/auth/password/reset", 403)]:
                    connection = http.client.HTTPSConnection("127.0.0.1", server.server_port, context=trusted)
                    connection.request(method, path, body=body, headers={"Authorization": "Bearer isolated"})
                    response = connection.getresponse()
                    self.assertEqual(response.status, expected)
                    response.read()
                    connection.close()
                self.assertEqual(received, [("/auth/password", body, "Bearer isolated")])
                self.assertNotIn(("POST", "/access/gate/open"), PASSWORD_ALLOWED)
            finally:
                for service in [server, upstream]:
                    service.shutdown()
                    service.server_close()


if __name__ == "__main__":
    unittest.main()
