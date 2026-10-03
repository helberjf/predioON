import unittest
import xml.etree.ElementTree as ET
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import ssl
import subprocess
import tempfile
import threading
from unittest.mock import patch
import assertions

from assertions import PrivacyViolation, allows, inspect_domain, action_node, assert_snapshot
from run_domains import APPS, DomainDevice, main, run
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
    def test_revoked_navigation_accepts_empty_summary_headings_without_resource_actions(self):
        source = page("Somente chamados concedidos ao seu perfil.", "Alertas em aberto", "Alertas recentes", "Nenhum alerta no seu escopo.", button="Solicitações")
        inspect_domain(source, PACKAGE, BUILDING, ["Somente chamados concedidos ao seu perfil."], ["Private sensor", "Private alert"], forbidden_actions=["Sensores", "Alertas"])

    def test_forbidden_navigation_requires_exact_native_button_even_when_disabled(self):
        for label in ["Sensores", "Alertas"]:
            for enabled in ["true", "false"]:
                for field in ["text", "content-desc"]:
                    root = ET.fromstring(page("Loading"))
                    ET.SubElement(root, "node", {"package": PACKAGE, "class": "android.widget.Button", field: label, "enabled": enabled, "clickable": "false", "bounds": "[0,0][0,0]"})
                    with self.subTest(label=label, enabled=enabled, field=field), self.assertRaises(PrivacyViolation):
                        inspect_domain(ET.tostring(root, encoding="unicode"), PACKAGE, BUILDING, ["Expected later"], [], forbidden_actions=[label])
        inspect_domain(page("Alertas", "Sensores", button="Alertas recentes"), PACKAGE, BUILDING, [], [], forbidden_actions=["Alertas", "Sensores"])

    def test_private_data_remains_substring_terminal_independently_of_navigation_labels(self):
        for field in ["text", "content-desc"]:
            root = ET.fromstring(page("Loading"))
            ET.SubElement(root, "node", {"package": PACKAGE, "class": "android.widget.TextView", field: "prefix PRIVATE suffix"})
            with self.subTest(field=field), self.assertRaises(PrivacyViolation):
                inspect_domain(ET.tostring(root, encoding="unicode"), PACKAGE, BUILDING, ["Expected later"], ["PRIVATE"], forbidden_actions=["Alertas"])

    def test_revoked_action_and_private_data_stop_observation_without_capture_or_retry(self):
        for denied in [page("Loading", button="Alertas", enabled="false"), page("prefix PRIVATE suffix")]:
            with self.subTest(source=denied), tempfile.TemporaryDirectory() as directory:
                output = Path(directory)
                device = self.statement_device(output)
                with patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", side_effect=[denied, page("Allowed")]) as observe, patch.object(device, "screen") as capture, patch("run_domains.time.sleep") as sleep:
                    with self.assertRaises(RuntimeError):
                        device.wait_domain("revoke", ["Allowed"], [], forbidden_actions=["Alertas"])
                    observe.assert_called_once_with()
                    sleep.assert_not_called()
                    capture.assert_not_called()
                    self.assertTrue(device.security_failed)
                    self.assertEqual(list(output.iterdir()), [])

    def test_credentials_in_incomplete_domain_observation_are_terminal_without_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            device = self.statement_device(output)
            with patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", side_effect=["<hierarchy>" + device.password, page("Allowed")]) as observe, patch.object(device, "screen") as capture, patch("run_domains.time.sleep") as sleep:
                with self.assertRaisesRegex(RuntimeError, "Credentials leaked"):
                    device.wait_domain("credentials", ["Allowed"])
                observe.assert_called_once_with()
                sleep.assert_not_called()
                capture.assert_not_called()
                self.assertTrue(device.security_failed)
                first = dict(device.security_failure)
                self.assertEqual(first["kind"], "credential-exposure")
                self.assertRegex(first["observedAt"], r"\+00:00$")
                self.assertEqual(set(first), {"kind", "observedAt"})
                device.record_security_failure("private-domain-content")
                self.assertEqual(device.security_failure, first)
                self.assertEqual(list(output.iterdir()), [])

    def test_collection_stops_after_security_failure_without_any_new_device_observation(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            device = self.statement_device(output)
            device.preflight_passed = True
            device.security_failed = True
            with patch.object(device, "adb") as command, patch.object(device, "hierarchy") as observe, patch.object(device, "screen") as capture:
                device.collect()
                command.assert_not_called()
                observe.assert_not_called()
                capture.assert_not_called()
                self.assertEqual(list(output.iterdir()), [])

    def test_shared_emulator_security_failure_blocks_collection_of_both_apps(self):
        for failed_index in [0, 1]:
            with self.subTest(failed_app=failed_index), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                fixture = root / "fixture.json"
                fixture.write_text(json.dumps({"forbidden": [], "accounts": {app: {"buildingName": BUILDING} for app in APPS}}), encoding="utf-8")
                def deny(devices, *_args):
                    for device in devices:
                        device.preflight_passed = True
                    devices[failed_index].security_failed = True
                    raise RuntimeError("Private domain content is visible")
                argv = ["run_domains.py", "--fixture", str(fixture), "--apks", str(root / "apks"), "--artifacts", str(root / "output")]
                with patch("run_domains.sys.argv", argv), patch.dict("run_domains.os.environ", {"ANDROID_AUTH_PASSWORD": "FixturePassword123"}), patch("run_domains.run", side_effect=deny), patch.object(DomainDevice, "collect") as collect, patch("builtins.print"):
                    with self.assertRaises(SystemExit):
                        main()
                    collect.assert_not_called()
                    self.assertFalse(json.loads((root / "output/result.json").read_text(encoding="utf-8"))["passed"])

    def test_main_physical_guard_denial_never_collects_or_captures_device_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = root / "fixture.json"
            fixture.write_text(json.dumps({"labels": {}, "forbidden": [], "accounts": {app: {"buildingName": BUILDING} for app in APPS}}), encoding="utf-8")
            argv = ["run_domains.py", "--fixture", str(fixture), "--apks", str(root / "apks"), "--artifacts", str(root / "output")]
            with patch("run_domains.sys.argv", argv), patch.dict("run_domains.os.environ", {"ANDROID_AUTH_PASSWORD": "FixturePassword123"}), patch.object(DomainDevice, "adb", return_value="0") as command, patch.object(DomainDevice, "collect") as collect, patch("builtins.print"):
                with self.assertRaises(SystemExit):
                    main()
                command.assert_called_once_with("shell", "getprop", "ro.kernel.qemu")
                collect.assert_not_called()

    def test_security_discovered_in_final_collection_rejects_success_and_blocks_other_app(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = root / "fixture.json"
            fixture.write_text(json.dumps({"forbidden": [], "accounts": {app: {"buildingName": BUILDING} for app in APPS}}), encoding="utf-8")
            def ready(devices, *_args):
                for device in devices:
                    device.preflight_passed = True
            def late_denial(device):
                device.record_security_failure("private-domain-content")
            argv = ["run_domains.py", "--fixture", str(fixture), "--apks", str(root / "apks"), "--artifacts", str(root / "output")]
            with patch("run_domains.sys.argv", argv), patch.dict("run_domains.os.environ", {"ANDROID_AUTH_PASSWORD": "FixturePassword123"}), patch("run_domains.run", side_effect=ready), patch("run_domains.AuthDevice.collect", autospec=True, side_effect=late_denial) as collect, patch("builtins.print"):
                with self.assertRaises(SystemExit):
                    main()
                collect.assert_called_once()
                report = json.loads((root / "output/result.json").read_text(encoding="utf-8"))
                self.assertFalse(report["passed"])
                self.assertEqual(len(report["securityFailures"]), 1)
                self.assertEqual(report["securityFailures"]["resident-mobile"]["kind"], "private-domain-content")

    def statement_device(self, output):
        fixture = {"forbidden": ["PRIVATE"], "accounts": {"operations-mobile": {"buildingName": BUILDING}}}
        return DomainDevice("unused", "operations-mobile", output, fixture, "FixturePassword123")

    def statement_page(self):
        source = ET.fromstring(page("Prestação de contas", "Published statement", button="Ver lançamentos (1)"))
        for node in source.iter("node"):
            if node.get("text") == "Published statement":
                node.set("bounds", "[10,100][500,160]")
        return ET.tostring(source, encoding="unicode")

    def test_financial_heading_and_loader_cannot_approve_the_statement_or_trigger_a_tap(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            device = self.statement_device(output)
            with patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", return_value=page("Prestação de contas", "Carregando")) as observe, patch.object(device, "scroll") as scroll, patch.object(device, "screen") as capture, patch.object(device, "adb") as command, patch("run_domains.time.sleep"):
                with self.assertRaisesRegex(AssertionError, "statement"):
                    device.wait_statement("finance", "Published statement")
                self.assertEqual(observe.call_count, 9)
                self.assertEqual(scroll.call_count, 8)
                capture.assert_not_called()
                command.assert_not_called()
                self.assertEqual(device.steps, [])
                self.assertEqual(list(output.iterdir()), [])

    def test_financial_phase_requires_visible_published_title_and_enabled_entry_control(self):
        good = self.statement_page()
        hidden = good.replace('[10,100][500,160]', '[0,0][0,0]')
        disabled = good.replace('enabled="true"', 'enabled="false"')
        for earlier in [page("Prestação de contas", "Carregando"), hidden, disabled]:
            with tempfile.TemporaryDirectory() as directory:
                output = Path(directory)
                device = self.statement_device(output)
                with patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", side_effect=[earlier, good]), patch.object(device, "scroll") as scroll, patch.object(device, "screen") as capture, patch.object(device, "adb") as command, patch("run_domains.time.sleep"):
                    device.wait_statement("finance", "Published statement")
                    scroll.assert_called_once_with()
                    capture.assert_called_once_with("finance")
                    command.assert_not_called()
                    self.assertEqual(device.steps, [{"phase": "finance", "passed": True}])
                    self.assertEqual((output / "finance.xml").read_text(encoding="utf-8"), good)

    def test_financial_privacy_failure_is_terminal_before_any_scroll_or_approved_capture(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            device = self.statement_device(output)
            with patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", side_effect=[page("PRIVATE"), self.statement_page()]) as observe, patch.object(device, "scroll") as scroll, patch.object(device, "screen") as capture, patch("run_domains.time.sleep"):
                with self.assertRaisesRegex(PrivacyViolation, "Private neighbor"):
                    device.wait_statement("finance", "Published statement")
                observe.assert_called_once_with()
                scroll.assert_not_called()
                capture.assert_not_called()
                self.assertEqual(device.steps, [])
                self.assertEqual(list(output.iterdir()), [])

    def test_financial_incomplete_observation_retries_and_captures_only_the_ready_statement(self):
        good = self.statement_page()
        for earlier in [AssertionError("UIAutomator did not produce a hierarchy: null root node"),
                        "<hierarchy>", good.replace(BUILDING, ""), "<hierarchy />"]:
            with self.subTest(observation=repr(earlier)), tempfile.TemporaryDirectory() as directory:
                output = Path(directory)
                device = self.statement_device(output)
                with patch.object(device, "assert_no_crash") as diagnose, patch.object(device, "hierarchy", side_effect=[earlier, good]) as observe, patch.object(device, "scroll") as scroll, patch.object(device, "screen") as capture, patch.object(device, "adb") as command, patch("run_domains.time.sleep") as sleep:
                    device.wait_statement("finance", "Published statement")
                    self.assertEqual(diagnose.call_count, 2)
                    self.assertEqual(observe.call_count, 2)
                    scroll.assert_called_once_with()
                    sleep.assert_called_once_with(0.5)
                    capture.assert_called_once_with("finance")
                    command.assert_not_called()
                    self.assertEqual(device.steps, [{"phase": "finance", "passed": True}])
                    self.assertEqual((output / "finance.xml").read_text(encoding="utf-8"), good)

    def test_financial_incomplete_observation_expires_without_approving_the_phase(self):
        for incomplete, error in [(AssertionError("null root node"), AssertionError),
                                  ("<hierarchy>", ET.ParseError),
                                  (self.statement_page().replace(BUILDING, ""), AssertionError)]:
            with self.subTest(observation=repr(incomplete)), tempfile.TemporaryDirectory() as directory:
                output = Path(directory)
                device = self.statement_device(output)
                with patch.object(device, "assert_no_crash") as diagnose, patch.object(device, "hierarchy", side_effect=[incomplete] * 9) as observe, patch.object(device, "scroll") as scroll, patch.object(device, "screen") as capture, patch.object(device, "adb") as command, patch("run_domains.time.sleep") as sleep:
                    with self.assertRaises(error):
                        device.wait_statement("finance", "Published statement")
                    self.assertEqual(diagnose.call_count, 9)
                    self.assertEqual(observe.call_count, 9)
                    self.assertEqual(scroll.call_count, 8)
                    self.assertEqual(sleep.call_count, 8)
                    capture.assert_not_called()
                    command.assert_not_called()
                    self.assertEqual(device.steps, [])
                    self.assertEqual(list(output.iterdir()), [])

    def test_financial_credentials_failure_is_terminal_even_in_incomplete_xml(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            device = self.statement_device(output)
            with patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", side_effect=["<hierarchy>" + device.password, self.statement_page()]) as observe, patch.object(device, "scroll") as scroll, patch.object(device, "screen") as capture, patch.object(device, "adb") as command, patch("run_domains.time.sleep") as sleep:
                with self.assertRaisesRegex(RuntimeError, "Credentials leaked"):
                    device.wait_statement("finance", "Published statement")
                observe.assert_called_once_with()
                scroll.assert_not_called()
                sleep.assert_not_called()
                capture.assert_not_called()
                command.assert_not_called()
                self.assertEqual(device.steps, [])
                self.assertEqual(list(output.iterdir()), [])

    def test_financial_crash_failure_is_terminal_before_observing_the_screen(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            device = self.statement_device(output)
            failure = AssertionError("Application crash or ANR found in logcat")
            with patch.object(device, "assert_no_crash", side_effect=failure) as diagnose, patch.object(device, "hierarchy") as observe, patch.object(device, "scroll") as scroll, patch.object(device, "screen") as capture, patch.object(device, "adb") as command, patch("run_domains.time.sleep") as sleep:
                with self.assertRaises(AssertionError) as raised:
                    device.wait_statement("finance", "Published statement")
                self.assertIs(raised.exception, failure)
                diagnose.assert_called_once_with()
                observe.assert_not_called()
                scroll.assert_not_called()
                sleep.assert_not_called()
                capture.assert_not_called()
                command.assert_not_called()
                self.assertEqual(device.steps, [])
                self.assertEqual(list(output.iterdir()), [])

    def test_financial_adb_failure_or_timeout_is_terminal_before_retrying_the_dump(self):
        for failure in [RuntimeError("adb shell uiautomator failed (exit 1)"),
                        subprocess.TimeoutExpired(["adb", "shell", "uiautomator"], 20)]:
            with self.subTest(failure=type(failure).__name__), tempfile.TemporaryDirectory() as directory:
                output = Path(directory)
                device = self.statement_device(output)
                with patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", wraps=device.hierarchy) as observe, patch.object(device, "scroll") as scroll, patch.object(device, "screen") as capture, patch.object(device, "adb", side_effect=failure) as command, patch("run_domains.time.sleep") as sleep:
                    with self.assertRaises(type(failure)) as raised:
                        device.wait_statement("finance", "Published statement")
                    self.assertIs(raised.exception, failure)
                    observe.assert_called_once_with()
                    command.assert_called_once_with("shell", "uiautomator", "dump", "/sdcard/predioon-smoke.xml", timeout=20, record_hierarchy=True)
                    scroll.assert_not_called()
                    sleep.assert_not_called()
                    capture.assert_not_called()
                    self.assertEqual(device.steps, [])
                    self.assertEqual(list(output.iterdir()), [])

    def test_financial_adb_scroll_failure_is_terminal_without_observing_again(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            device = self.statement_device(output)
            failure = RuntimeError("adb shell input failed (exit 1)")
            with patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", side_effect=[page("Prestação de contas", "Carregando"), self.statement_page()]) as observe, patch.object(device, "screen") as capture, patch.object(device, "adb", side_effect=["Physical size: 1080x2400", failure]) as command, patch("run_domains.time.sleep") as sleep:
                with self.assertRaises(RuntimeError) as raised:
                    device.wait_statement("finance", "Published statement")
                self.assertIs(raised.exception, failure)
                observe.assert_called_once_with()
                self.assertEqual(command.call_count, 2)
                sleep.assert_not_called()
                capture.assert_not_called()
                self.assertEqual(device.steps, [])
                self.assertEqual(list(output.iterdir()), [])

    def test_comment_waits_for_submission_confirmation_before_scrolling_and_never_resends(self):
        fixture = {"forbidden": [], "accounts": {"operations-mobile": {"buildingName": BUILDING}}}
        device = DomainDevice("unused", "operations-mobile", Path("unused"), fixture, "FixturePassword123")
        for fails in [False, True]:
            steps = []
            def wait(phase, required):
                steps.append(("wait", phase, required))
                if fails:
                    raise AssertionError("Submission confirmation did not arrive")
            with patch.object(device, "fill", side_effect=lambda *args: steps.append(("fill", *args))), patch.object(device, "tap", side_effect=lambda *args: steps.append(("tap", *args))), patch.object(device, "wait_domain", side_effect=wait), patch.object(device, "top", side_effect=lambda: steps.append(("top",))), patch.object(device, "find_text", side_effect=lambda *args: steps.append(("find", *args))):
                if fails:
                    with self.assertRaisesRegex(AssertionError, "confirmation"):
                        device.send_comment("10-comment", "Equipe iniciou o atendimento")
                else:
                    device.send_comment("10-comment", "Equipe iniciou o atendimento")
            expected = [("fill", "Nova mensagem", "Equipe iniciou o atendimento"), ("tap", "Enviar mensagem"), ("wait", "10-comment-sent", ["Mensagem enviada."])]
            if not fails:
                expected.extend([("top",), ("find", "Equipe iniciou o atendimento"), ("wait", "10-comment", ["Equipe iniciou o atendimento"])])
            self.assertEqual(steps, expected)

    def test_comment_below_status_event_is_scrolled_into_view_without_another_send(self):
        fixture = {"forbidden": [], "accounts": {"operations-mobile": {"buildingName": BUILDING}}}
        hidden = ET.Element("node", {"class": "android.widget.TextView", "text": "Equipe iniciou o atendimento", "bounds": "[103,2390][979,2337]"})
        visible = ET.Element("node", {**hidden.attrib, "bounds": "[103,1500][979,1560]"})
        device = DomainDevice("unused", "operations-mobile", Path("unused"), fixture, "FixturePassword123")
        with patch.object(device, "nodes", side_effect=[[hidden], [visible]]), patch.object(device, "scroll") as scroll, patch.object(device, "adb") as command, patch("run_domains.time.sleep"):
            self.assertIs(device.find_text("Equipe iniciou o atendimento"), visible)
            scroll.assert_called_once_with()
            command.assert_not_called()

    def test_missing_comment_expires_without_replaying_a_write_or_tap(self):
        fixture = {"forbidden": [], "accounts": {"operations-mobile": {"buildingName": BUILDING}}}
        device = DomainDevice("unused", "operations-mobile", Path("unused"), fixture, "FixturePassword123")
        with patch.object(device, "nodes", return_value=[]) as observe, patch.object(device, "scroll") as scroll, patch.object(device, "adb") as command, patch("run_domains.time.sleep"):
            with self.assertRaisesRegex(AssertionError, "found 0"):
                device.find_text("Equipe iniciou o atendimento")
            self.assertEqual(observe.call_count, 9)
            self.assertEqual(scroll.call_count, 8)
            command.assert_not_called()

    def test_offscreen_field_is_scrolled_into_view_before_any_input_action(self):
        fixture = {"forbidden": [], "accounts": {"operations-mobile": {"buildingName": BUILDING}}}
        hidden = ET.Element("node", {"class": "android.widget.EditText", "content-desc": "Nova mensagem", "enabled": "true", "bounds": "[103,2352][979,2337]"})
        visible = ET.Element("node", {**hidden.attrib, "bounds": "[103,1500][979,1700]"})
        device = DomainDevice("unused", "operations-mobile", Path("unused"), fixture, "FixturePassword123")
        with patch.object(device, "nodes", side_effect=[[hidden], [visible]]), patch.object(device, "scroll") as scroll, patch.object(device, "adb") as command, patch("run_domains.time.sleep"):
            self.assertIs(device.find("Nova mensagem", field=True), visible)
            scroll.assert_called_once_with()
            command.assert_not_called()

    def test_permanently_hidden_field_expires_without_tapping_or_typing(self):
        fixture = {"forbidden": [], "accounts": {"operations-mobile": {"buildingName": BUILDING}}}
        hidden = ET.Element("node", {"class": "android.widget.EditText", "content-desc": "Nova mensagem", "enabled": "true", "bounds": "[0,0][0,0]"})
        device = DomainDevice("unused", "operations-mobile", Path("unused"), fixture, "FixturePassword123")
        with patch.object(device, "nodes", return_value=[hidden]) as observe, patch.object(device, "scroll") as scroll, patch.object(device, "adb") as command, patch("run_domains.time.sleep"):
            with self.assertRaisesRegex(AssertionError, "visible area"):
                device.find("Nova mensagem", field=True)
            self.assertEqual(observe.call_count, 9)
            self.assertEqual(scroll.call_count, 8)
            command.assert_not_called()

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


class ResumeAssertions(unittest.TestCase):
    HOME = "com.google.android.apps.nexuslauncher"
    COMPONENT = HOME + "/.NexusLauncherActivity"

    def device(self, output):
        fixture = {"forbidden": ["PRIVATE"], "accounts": {"operations-mobile": {"buildingName": BUILDING}}}
        return DomainDevice("emulator-5554", "operations-mobile", output, fixture, "FixturePassword123")

    def home_page(self, bounds="[0,0][1080,2400]"):
        root = ET.Element("hierarchy")
        ET.SubElement(root, "node", {"package": self.HOME, "class": "android.widget.FrameLayout", "bounds": bounds})
        return ET.tostring(root, encoding="unicode")

    def activities(self, state="STOPPED", package=PACKAGE, component=None):
        return (f"    topResumedActivity=ActivityRecord{{abc u0 {component or self.COMPONENT} t1}}\n"
                f"    * Hist  #0: ActivityRecord{{abc u0 {component or self.COMPONENT} t1}}\n"
                "      state=RESUMED delayedResume=false\n"
                f"    * Hist  #1: ActivityRecord{{def u0 {package}/.MainActivity t2}}\n"
                f"      state={state} delayedResume=false\n")

    def adb_reply(self, events, qemu="1", boot="1", resolution=None, crash="", failure=None, activities=None):
        def reply(*args, **kwargs):
            events.append(("adb", args))
            if failure and args == failure[0]:
                raise failure[1]
            if args == ("shell", "getprop", "ro.kernel.qemu"):
                return qemu
            if args == ("shell", "getprop", "sys.boot_completed"):
                return boot
            if args[:4] == ("shell", "cmd", "package", "resolve-activity"):
                return resolution() if resolution else self.COMPONENT
            if args == ("logcat", "-d", "-v", "threadtime"):
                return crash
            if args == ("shell", "dumpsys", "activity", "activities"):
                return activities() if activities else self.activities()
            return ""
        return reply

    def test_resume_launches_only_after_two_visible_resolved_home_observations(self):
        with tempfile.TemporaryDirectory() as directory:
            device = self.device(Path(directory))
            events, sources = [], iter([page("Resumo"), self.home_page(), self.home_page()])
            def observe():
                source = next(sources)
                events.append(("observe", source))
                return source
            with patch.object(device, "adb", side_effect=self.adb_reply(events)), patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", side_effect=observe), patch.object(device, "launch", side_effect=lambda: events.append(("launch",))) as launch, patch.object(device, "screen") as capture, patch("run_domains.time.sleep", side_effect=lambda seconds: events.append(("sleep", seconds))), patch("run_domains.time.monotonic", return_value=0):
                device.resume()
                launch.assert_called_once_with()
                capture.assert_not_called()
                observed = [item[1] for item in events if item[0] == "observe"]
                self.assertEqual(observed, [page("Resumo"), self.home_page(), self.home_page()])
                self.assertEqual(events[-1], ("launch",))
                self.assertEqual(sum(item[0] == "sleep" for item in events), 2)
                self.assertFalse(any(item[0] == "adb" and "force-stop" in item[1] for item in events))

    def test_resume_refuses_physical_or_unbooted_device_before_home_and_launch(self):
        for qemu, boot, calls in [("0", "1", 1), ("1", "0", 2)]:
            with self.subTest(qemu=qemu, boot=boot), tempfile.TemporaryDirectory() as directory:
                device, events = self.device(Path(directory)), []
                with patch.object(device, "adb", side_effect=self.adb_reply(events, qemu, boot)) as command, patch.object(device, "assert_no_crash") as diagnose, patch.object(device, "hierarchy") as observe, patch.object(device, "launch") as launch:
                    with self.assertRaises(AssertionError):
                        device.resume()
                    self.assertEqual(command.call_count, calls)
                    diagnose.assert_not_called()
                    observe.assert_not_called()
                    launch.assert_not_called()

    def test_resume_waits_for_incomplete_or_wrong_xml_without_capturing_it(self):
        for incomplete in ["<hierarchy>", AssertionError("null root node"), self.home_page("[0,0][0,0]")]:
            with self.subTest(observation=repr(incomplete)), tempfile.TemporaryDirectory() as directory:
                device, events = self.device(Path(directory)), []
                with patch.object(device, "adb", side_effect=self.adb_reply(events)), patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", side_effect=[incomplete, self.home_page(), self.home_page()]) as observe, patch.object(device, "launch") as launch, patch.object(device, "screen") as capture, patch("run_domains.time.sleep") as sleep, patch("run_domains.time.monotonic", return_value=0):
                    device.resume()
                    self.assertEqual(observe.call_count, 3)
                    self.assertEqual(sleep.call_count, 2)
                    launch.assert_called_once_with()
                    capture.assert_not_called()
                    self.assertEqual(list(Path(directory).iterdir()), [])

    def test_resume_expires_after_nine_wrong_observations_without_launching(self):
        with tempfile.TemporaryDirectory() as directory:
            device, events = self.device(Path(directory)), []
            with patch.object(device, "adb", side_effect=self.adb_reply(events)), patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", return_value=page("Resumo")) as observe, patch.object(device, "launch") as launch, patch.object(device, "screen") as capture, patch("run_domains.time.sleep") as sleep, patch("run_domains.time.monotonic", return_value=0):
                with self.assertRaisesRegex(AssertionError, "HOME"):
                    device.resume()
                self.assertEqual(observe.call_count, 9)
                self.assertEqual(sleep.call_count, 8)
                launch.assert_not_called()
                capture.assert_not_called()

    def test_resume_requires_the_same_home_identity_for_both_ready_observations(self):
        with tempfile.TemporaryDirectory() as directory:
            device, events = self.device(Path(directory)), []
            resolutions = iter(["com.android.launcher3/.Launcher", self.COMPONENT, self.COMPONENT])
            states = iter([self.activities(component="com.android.launcher3/.Launcher"), self.activities(), self.activities()])
            other = self.home_page().replace(self.HOME, "com.android.launcher3")
            with patch.object(device, "adb", side_effect=self.adb_reply(events, resolution=lambda: next(resolutions), activities=lambda: next(states))), patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", side_effect=[other, self.home_page(), self.home_page()]) as observe, patch.object(device, "launch") as launch, patch("run_domains.time.sleep") as sleep, patch("run_domains.time.monotonic", return_value=0):
                device.resume()
                self.assertEqual(observe.call_count, 3)
                self.assertEqual(sleep.call_count, 2)
                launch.assert_called_once_with()

    def test_resume_adb_failure_or_timeout_never_retries_or_launches(self):
        home = ("shell", "input", "keyevent", "KEYCODE_HOME")
        resolve = ("shell", "cmd", "package", "resolve-activity", "--brief", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.HOME")
        for target in [home, resolve]:
            for failure in [RuntimeError("ADB failed"), subprocess.TimeoutExpired(["adb"], 20)]:
                with self.subTest(target=target, failure=type(failure).__name__), tempfile.TemporaryDirectory() as directory:
                    device, events = self.device(Path(directory)), []
                    with patch.object(device, "adb", side_effect=self.adb_reply(events, failure=(target, failure))), patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy") as observe, patch.object(device, "launch") as launch, patch("run_domains.time.sleep") as sleep:
                        with self.assertRaises(type(failure)) as raised:
                            device.resume()
                        self.assertIs(raised.exception, failure)
                        self.assertEqual(sum(item == ("adb", target) for item in events), 1)
                        observe.assert_not_called()
                        launch.assert_not_called()
                        sleep.assert_not_called()

    def test_resume_home_anr_and_system_dialog_are_terminal_before_launch(self):
        root = ET.fromstring(self.home_page())
        ET.SubElement(root, "node", {"package": "android", "resource-id": "android:id/alertTitle", "text": "Pixel Launcher isn't responding"})
        for crash, source in [("ANR in " + self.HOME, self.home_page()), ("", ET.tostring(root, encoding="unicode"))]:
            with self.subTest(crash=crash), tempfile.TemporaryDirectory() as directory:
                device, events = self.device(Path(directory)), []
                with patch.object(device, "adb", side_effect=self.adb_reply(events, crash=crash)), patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", return_value=source) as observe, patch.object(device, "launch") as launch, patch.object(device, "screen") as capture, patch("run_domains.time.sleep") as sleep:
                    with self.assertRaises(RuntimeError):
                        device.resume()
                    self.assertLessEqual(observe.call_count, 1)
                    launch.assert_not_called()
                    capture.assert_not_called()
                    sleep.assert_not_called()

    def test_resume_app_crash_credentials_and_private_data_are_terminal(self):
        for source, crash in [(self.home_page(), AssertionError("Application crash or ANR")), ("<hierarchy>FixturePassword123", None), (page("prefix PRIVATE suffix"), None)]:
            with self.subTest(source=source, crash=crash), tempfile.TemporaryDirectory() as directory:
                device, events = self.device(Path(directory)), []
                with patch.object(device, "adb", side_effect=self.adb_reply(events)), patch.object(device, "assert_no_crash", side_effect=crash), patch.object(device, "hierarchy", side_effect=[source, self.home_page()]) as observe, patch.object(device, "launch") as launch, patch.object(device, "screen") as capture, patch("run_domains.time.sleep") as sleep:
                    with self.assertRaises((RuntimeError, AssertionError)):
                        device.resume()
                    self.assertLessEqual(observe.call_count, 1)
                    launch.assert_not_called()
                    capture.assert_not_called()
                    sleep.assert_not_called()
                    if not crash:
                        self.assertTrue(device.security_failed)

    def test_background_proof_requires_own_stopped_record_and_resumed_resolved_home(self):
        assertions.assert_background_activity(self.activities(), PACKAGE, self.COMPONENT)
        expanded = self.activities().replace(self.COMPONENT, self.HOME + "/" + self.HOME + ".NexusLauncherActivity")
        assertions.assert_background_activity(expanded, PACKAGE, self.COMPONENT)
        for unsafe in [self.activities("RESUMED"), self.activities("PAUSED"), self.activities("STOPPING"),
                       self.activities(package="com.predioon.other"), self.activities(component=PACKAGE + "/.MainActivity"),
                       self.activities() + f"    * Hist  #2: ActivityRecord{{ghi u0 {PACKAGE}/.MainActivity t3}}\n      state=RESUMED\n",
                       "ActivityRecord{" + PACKAGE + "/.MainActivity}\nstate=STOPPED"]:
            with self.subTest(activities=unsafe), self.assertRaises(AssertionError):
                assertions.assert_background_activity(unsafe, PACKAGE, self.COMPONENT)

    def test_revoke_callback_occurs_after_background_proof_and_before_single_launch(self):
        with tempfile.TemporaryDirectory() as directory:
            device, events = self.device(Path(directory)), []
            with patch.object(device, "adb", side_effect=self.adb_reply(events)), patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", return_value=self.home_page()), patch.object(device, "launch", side_effect=lambda: events.append(("launch",))) as launch, patch("run_domains.time.sleep"), patch("run_domains.time.monotonic", return_value=0):
                device.resume(lambda: events.append(("revoke",)))
                self.assertEqual(events[-2:], [("revoke",), ("launch",)])
                self.assertEqual(sum(item == ("adb", ("shell", "dumpsys", "activity", "activities")) for item in events), 2)
                launch.assert_called_once_with()

    def test_visible_home_without_own_stopped_activity_cannot_revoke_or_launch(self):
        for states in [iter([self.activities("RESUMED"), self.activities(), self.activities()]), None]:
            with self.subTest(eventually_stopped=bool(states)), tempfile.TemporaryDirectory() as directory:
                device, events = self.device(Path(directory)), []
                def activity():
                    return next(states) if states else self.activities("PAUSED")
                with patch.object(device, "adb", side_effect=self.adb_reply(events, activities=activity)), patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", return_value=self.home_page()) as observe, patch.object(device, "launch") as launch, patch("run_domains.time.sleep") as sleep, patch("run_domains.time.monotonic", return_value=0):
                    callback = unittest.mock.Mock()
                    if states:
                        device.resume(callback)
                        self.assertEqual(observe.call_count, 3)
                        callback.assert_called_once_with()
                        launch.assert_called_once_with()
                    else:
                        with self.assertRaisesRegex(AssertionError, "HOME"):
                            device.resume(callback)
                        self.assertEqual(observe.call_count, 9)
                        self.assertEqual(sleep.call_count, 8)
                        callback.assert_not_called()
                        launch.assert_not_called()

    def test_revoke_failure_after_confirmed_background_never_launches_or_retries(self):
        with tempfile.TemporaryDirectory() as directory:
            device, events = self.device(Path(directory)), []
            failure = RuntimeError("Fixture revocation failed")
            with patch.object(device, "adb", side_effect=self.adb_reply(events)), patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", return_value=self.home_page()), patch.object(device, "launch") as launch, patch.object(device, "screen") as capture, patch("run_domains.time.sleep"), patch("run_domains.time.monotonic", return_value=0):
                callback = unittest.mock.Mock(side_effect=failure)
                with self.assertRaises(RuntimeError) as raised:
                    device.resume(callback)
                self.assertIs(raised.exception, failure)
                callback.assert_called_once_with()
                launch.assert_not_called()
                capture.assert_not_called()

    def test_background_activity_adb_failure_blocks_revocation_and_launch(self):
        with tempfile.TemporaryDirectory() as directory:
            device, events = self.device(Path(directory)), []
            target = ("shell", "dumpsys", "activity", "activities")
            failure = subprocess.TimeoutExpired(["adb"], 20)
            with patch.object(device, "adb", side_effect=self.adb_reply(events, failure=(target, failure))), patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", return_value=self.home_page()), patch.object(device, "launch") as launch, patch("run_domains.time.sleep") as sleep:
                callback = unittest.mock.Mock()
                with self.assertRaises(subprocess.TimeoutExpired) as raised:
                    device.resume(callback)
                self.assertIs(raised.exception, failure)
                callback.assert_not_called()
                launch.assert_not_called()
                sleep.assert_not_called()

    def test_background_deadline_expires_before_revocation_or_launch_even_after_ready_reads(self):
        with tempfile.TemporaryDirectory() as directory:
            device, events = self.device(Path(directory)), []
            with patch.object(device, "adb", side_effect=self.adb_reply(events)), patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", return_value=self.home_page()), patch.object(device, "launch") as launch, patch("run_domains.time.sleep"), patch("run_domains.time.monotonic", side_effect=[0, 0, 0, 90]):
                callback = unittest.mock.Mock()
                with self.assertRaisesRegex(AssertionError, "HOME"):
                    device.resume(callback)
                callback.assert_not_called()
                launch.assert_not_called()

    def test_app_crash_during_revocation_prevents_restarting_a_new_process(self):
        with tempfile.TemporaryDirectory() as directory:
            device, events = self.device(Path(directory)), []
            failure = AssertionError("Application process stopped unexpectedly")
            with patch.object(device, "adb", side_effect=self.adb_reply(events)), patch.object(device, "assert_no_crash", side_effect=[None, None, failure]), patch.object(device, "hierarchy", return_value=self.home_page()), patch.object(device, "launch") as launch, patch("run_domains.time.sleep"), patch("run_domains.time.monotonic", return_value=0):
                callback = unittest.mock.Mock()
                with self.assertRaises(AssertionError) as raised:
                    device.resume(callback)
                self.assertIs(raised.exception, failure)
                callback.assert_called_once_with()
                launch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
