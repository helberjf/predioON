import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import ssl
import tempfile
import threading
import unittest
import xml.etree.ElementTree as ET
from unittest.mock import patch

from reservation_assertions import allows, assert_snapshot, inspect_calendar, inspect_confirmation, CALENDAR_END
from run_reservations import run, ReservationDevice
from proxy import make_handler
from tls import create_certificates

PACKAGE = "com.predioon.resident"
BUILDING = "Condominio Reservas CI"
EMPTY = "Nenhum horário ocupado nesta data."
DENIED = "Sem permissão para consultar os horários desta área."


def page(*labels):
    root = ET.Element("hierarchy")
    for label in [BUILDING, *labels]:
        ET.SubElement(root, "node", {"package": PACKAGE, "class": "android.widget.TextView", "text": label})
    return ET.tostring(root, encoding="unicode")


def dialog():
    root = ET.Element("hierarchy")
    for text, identifier, kind in [("Cancelar reserva?", "alertTitle", "TextView"), ("O horário será liberado para outros moradores.", "message", "TextView"), ("VOLTAR", "button2", "Button"), ("CANCELAR RESERVA", "button1", "Button")]:
        ET.SubElement(root, "node", {"package": PACKAGE, "class": "android.widget." + kind, "resource-id": "android:id/" + identifier,
                                    "text": text, "enabled": "true", "clickable": "true", "bounds": "[10,20][110,80]"})
    return ET.tostring(root, encoding="unicode")


class ReservationAssertions(unittest.TestCase):
    def test_observed_androidx_dialog_uses_the_application_title_resource_and_strict_native_buttons(self):
        # Captured from run36973342789 at ed21b67; the dialog contains no account data.
        source = (Path(__file__).parent / "fixtures/reservation-confirmation-androidx.xml").read_text(encoding="utf-8")
        result = inspect_confirmation(source, PACKAGE)
        self.assertEqual(result["back"].get("resource-id"), "android:id/button2")
        self.assertEqual(result["confirm"].get("resource-id"), "android:id/button1")
        for invalid in [source.replace(PACKAGE + ":id/alert_title", "other.app:id/alert_title"), source.replace("Cancelar reserva?", "Pixel Launcher isn't responding"), source.replace("android:id/button2", PACKAGE + ":id/button2"), source.replace("android:id/message", PACKAGE + ":id/message")]:
            with self.assertRaises(AssertionError):
                inspect_confirmation(invalid, PACKAGE)

    def test_calendar_private_content_is_terminal_without_capturing_an_approved_phase(self):
        fixture = {"forbidden": ["PRIVATE"], "accounts": {"resident-mobile": {"buildingName": BUILDING}}}
        with tempfile.TemporaryDirectory() as output:
            device = ReservationDevice("unused", "resident-mobile", Path(output), fixture, "FixturePassword123")
            with patch.object(device, "find_label"), patch.object(device, "assert_no_crash"), patch.object(device, "hierarchy", return_value=page("PRIVATE")) as observe, patch.object(device, "screen") as capture:
                with self.assertRaisesRegex(RuntimeError, "Private neighbor"):
                    device.calendar("privacy", "empty")
                self.assertEqual(observe.call_count, 1)
                capture.assert_not_called()
                self.assertEqual(list(Path(output).iterdir()), [])

    def test_timezone_mismatch_fails_before_installation_or_fixture_mutation(self):
        class Device:
            calls = []
            def adb(self, *args):
                self.calls.append(args)
                return {"ro.kernel.qemu": "1", "sys.boot_completed": "1", "persist.sys.timezone": "America/Sao_Paulo", "+%z": "-0300"}[args[-1]]
        device = Device()
        with patch("run_reservations.fixture_action") as mutate:
            with self.assertRaisesRegex(AssertionError, "UTC emulator"):
                run(device, Path("unused"), Path("unused"), Path("unused"))
            self.assertFalse(any("install" in call or "input" in call for call in device.calls))
            mutate.assert_not_called()

    def test_calendar_requires_real_intervals_and_keeps_denial_distinct_from_empty(self):
        interval = "05/10/2026, 19:00:00 até 05/10/2026, 20:00:00"
        inspect_calendar(page("Horários ocupados", interval, CALENDAR_END), PACKAGE, BUILDING, "occupied", ["PRIVATE"])
        inspect_calendar(page("Horários ocupados", EMPTY, CALENDAR_END, "Cancelado", interval), PACKAGE, BUILDING, "empty", [])
        inspect_calendar(page("Horários ocupados", DENIED, CALENDAR_END), PACKAGE, BUILDING, "denied", [])
        for labels, state in [([EMPTY], "occupied"), ([DENIED], "empty"), ([EMPTY, interval], "empty"), ([DENIED, interval], "denied"), ([interval, "PRIVATE UNIT"], "occupied")]:
            with self.subTest(labels=labels, state=state), self.assertRaises(AssertionError):
                inspect_calendar(page("Horários ocupados", *labels, CALENDAR_END), PACKAGE, BUILDING, state, ["PRIVATE"])

    def test_confirmation_requires_native_dialog_and_never_treats_anr_as_confirmation(self):
        result = inspect_confirmation(dialog(), PACKAGE)
        self.assertEqual(result["confirm"].get("resource-id"), "android:id/button1")
        self.assertEqual(result["back"].get("resource-id"), "android:id/button2")
        for xml in [page("Cancelar reserva?", "Cancelar reserva"), dialog().replace("Cancelar reserva?", "Excluir conta?"), dialog().replace(PACKAGE, "android"), dialog().replace('enabled="true"', 'enabled="false"')]:
            with self.assertRaises(AssertionError):
                inspect_confirmation(xml, PACKAGE)

    def test_database_proof_rejects_duplicate_or_wrong_status_actions_and_neighbor_edits(self):
        initial = {"ownTotal": 0, "ownConfirmed": 0, "ownPending": 0, "ownCancelled": 0, "createdAudits": 0, "cancelledAudits": 0, "neighborStatus": "CONFIRMED", "calendarGrantsActive": 2, "foreignStatus": "CONFIRMED"}
        assert_snapshot(initial, "initial")
        assert_snapshot(initial, "conflict")
        final = {**initial, "ownTotal": 2, "ownPending": 1, "ownCancelled": 1, "createdAudits": 2, "cancelledAudits": 1, "neighborStatus": "CANCELLED", "calendarGrantsActive": 0}
        assert_snapshot(final, "revoked")
        for key, value in [("ownTotal", 3), ("ownPending", 0), ("ownConfirmed", 1), ("createdAudits", 3), ("cancelledAudits", 2), ("foreignStatus", "CANCELLED"), ("calendarGrantsActive", 1)]:
            with self.assertRaises(AssertionError):
                assert_snapshot({**final, key: value}, "revoked")

    def test_policy_excludes_management_and_physical_commands(self):
        identifier = "11111111-1111-4111-8111-111111111111"
        for method, route in [("GET", "/reservations"), ("GET", "/reservations/availability"), ("GET", "/common-areas"), ("GET", "/v1/authorization"), ("POST", "/reservations"), ("DELETE", "/reservations/" + identifier), ("POST", "/auth/login")]:
            self.assertTrue(allows(method, route), (method, route))
        for method, route in [("POST", "/access/commands"), ("PATCH", "/common-areas/" + identifier), ("POST", "/reservations/" + identifier + "/approve"), ("DELETE", "/auth/sessions/" + identifier), ("GET", "https://remote.invalid/reservations"), ("DELETE", "/reservations/../users"), ("DELETE", "/reservations/" + identifier + "/extra")]:
            self.assertFalse(allows(method, route), (method, route))

    def test_physical_device_is_refused_before_data_or_ui_actions(self):
        class Physical:
            def adb(self, *args):
                self.calls.append(args)
                return "0"
            calls = []
        device = Physical()
        with patch("run_reservations.fixture_action") as mutate:
            with self.assertRaisesRegex(AssertionError, "disposable emulator"):
                run(device, Path("unused"), Path("unused"), Path("unused"))
            self.assertEqual(device.calls, [("shell", "getprop", "ro.kernel.qemu")])
            mutate.assert_not_called()

    @unittest.skipUnless(shutil.which("openssl"), "OpenSSL required for real TLS")
    def test_real_tls_auth_denies_delete_and_reservation_policy_forwards_only_own_route_shape(self):
        seen = []
        class Upstream(BaseHTTPRequestHandler):
            def do_DELETE(self):
                seen.append((self.command, self.path))
                self.send_response(204)
                self.end_headers()
            def log_message(self, *_args):
                pass
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            ca = create_certificates(path / "tls")
            upstream = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
            auth = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(upstream.server_port))
            reservations = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(upstream.server_port, allows))
            for server in [auth, reservations]:
                context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                context.load_cert_chain(path / "tls/server.pem", path / "tls/server.key")
                server.socket = context.wrap_socket(server.socket, server_side=True)
            services = [upstream, auth, reservations]
            for server in services:
                threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                trusted = ssl.create_default_context(cafile=str(ca))
                target = "/reservations/11111111-1111-4111-8111-111111111111"
                def request(server, method, route):
                    connection = http.client.HTTPSConnection("127.0.0.1", server.server_port, context=trusted)
                    try:
                        connection.request(method, route)
                        response = connection.getresponse()
                        response.read()
                        return response.status
                    finally:
                        connection.close()
                self.assertEqual(request(auth, "DELETE", target), 403)
                self.assertEqual(seen, [])
                self.assertEqual(request(reservations, "DELETE", target), 204)
                for server in [auth, reservations]:
                    self.assertEqual(request(server, "POST", "/access/commands"), 403)
                self.assertEqual(seen, [("DELETE", target)])
            finally:
                for server in reversed(services):
                    server.shutdown()
                    server.server_close()


if __name__ == "__main__":
    unittest.main()
