import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import run_domains_prefix as prefix
from monitor import RendererFailure, RendererMonitor, public_report


PID = 3540
SECRET = "PRIVATE_TREE_PASSWORD_NOT_FOR_PUBLICATION"
SOURCE = {"commit": "a" * 40, "apkSha256": "b" * 64, "reactNative": "0.87.1", "androidApi": 35, "abi": "x86_64"}
XML = '<hierarchy><node package="com.predioon.resident" text="safe" /></hierarchy>'
PNG = b"private-test-capture"
INITIAL = {"residentCreated": 0, "residentComments": 0, "operatorStatus": "OPEN", "operatorComments": 0,
           "alertStatus": "OPEN", "neighborStatus": "OPEN", "neighborAlertStatus": "OPEN", "neighborEvents": 0,
           "deviceGrantActive": True, "ticketGrantActive": True, "financeGrantActive": True}


def fixture():
    return {"accounts": {"resident-mobile": {"buildingName": "Own"}, "operations-mobile": {}},
            "forbidden": [SECRET], "labels": {"notice": "Notice", "report": "Report", "entry": "Entry", "ownTicket": "Own ticket"}}


def native(message="Unhandled SoftException", tag="unknown:SurfaceMountingManager:MissingViewState"):
    return f"1791065526.176 {PID} {PID} E {tag}: {message}\n"


class FakeDevice(prefix.PrefixDevice):
    def __init__(self, directory, *, failure=None, home=False):
        super().__init__("emulator-5554", directory, fixture(), "A" * 32)
        self.calls, self.tabs, self.inputs = [], [], []
        self.failure, self.home_failure = failure, home
        self.marker_values = []

    def raw(self, *args, **kwargs):
        self.calls.append(args)
        if args == ("devices",):
            return "List of devices attached\nemulator-5554\tdevice\n"
        if args[:2] == ("shell", "getprop"):
            return {"ro.kernel.qemu": "1", "sys.boot_completed": "1", "ro.build.version.sdk": "35",
                    "ro.product.cpu.abi": "x86_64"}[args[2]]
        if args == ("logcat", "--help"):
            return "--pid epoch"
        if args[:2] == ("shell", "pidof"):
            return str(PID)
        if args[:2] == ("shell", "log"):
            self.marker_values.append(args[-1])
            return ""
        if args[0] == "logcat" and "PredioonRenderer:I" in args:
            return "".join(f"1791065526.{i:03} 1 1 I PredioonRenderer: {v}\n" for i, v in enumerate(self.marker_values, 1))
        if args[:3] == ("shell", "am", "start"):
            return "Status: ok"
        if args[:2] == ("exec-out", "screencap"):
            return PNG
        return ""

    def wait_environment_ready(self):
        self.calls.append(("home-guard",))
        if self.home_failure:
            raise RendererFailure("ui-incomplete")

    def login(self, phase):
        self.adb("shell", "input", "tap", "1", "2")
        for suffix in ["blank", "email", "ready", "authenticated"]:
            self.capture(phase + "-" + suffix, XML)

    def enter_building(self, phase):
        self.capture(phase + "-profile", XML)
        self.adb("shell", "input", "tap", "1", "2")
        self.capture(phase + "-building", XML)

    def wait_domain(self, phase, required=(), forbidden=(), forbidden_actions=()):
        self.capture(phase, XML)

    def wait_statement(self, phase, title):
        if self.failure:
            self.monitor.observe(self.failure)
        self.capture(phase, XML, image_first=True)

    def tab(self, label):
        self.adb("shell", "input", "tap", "1", "2")
        self.tabs.append(label)

    def tap(self, label):
        self.adb("shell", "input", "tap", "1", "2")
        self.inputs.append(label)

    def scroll(self, down=True):
        self.adb("shell", "input", "swipe", "1", "2", "3", "4", "400")

    def top(self):
        self.scroll(False)


class PrefixTests(unittest.TestCase):
    def journey(self, device, *, snapshot=INITIAL):
        with patch.object(RendererMonitor, "start"), patch.object(prefix, "fixture_action", return_value=snapshot) as database:
            prefix.run(device, Path("apks"), Path("fixture.json"))
            return database

    def test_missing_during_finance_blocks_requests_writes_and_later_capture(self):
        with tempfile.TemporaryDirectory() as folder:
            device = FakeDevice(Path(folder), failure=native())
            with patch.object(RendererMonitor, "start"), patch.object(prefix, "fixture_action", return_value=INITIAL) as database:
                with self.assertRaisesRegex(RendererFailure, "renderer-missing-view-state"):
                    prefix.run(device, Path("apks"), Path("fixture.json"))
            self.assertEqual(device.tabs, ["Transparência"])
            self.assertEqual(device.inputs, [])
            self.assertFalse((Path(folder) / "04-finance.xml").exists())
            self.assertFalse((Path(folder) / "04-finance.png").exists())
            self.assertEqual([c.args[1] for c in database.call_args_list], ["snapshot"])
            self.assertEqual(device.monitor.failure["category"], "renderer-missing-view-state")

    def test_other_native_negatives_also_block_later_navigation(self):
        for message, category in [
            (native("removeViewAt: [1] -> [2] @0: view already removed from parent!", "unknown:SurfaceMountingManager"), "renderer-remove-view-at"),
            (native("ReactNoCrashSoftException: " + SECRET, "unknown:SurfaceMountingManager"), "renderer-soft-exception"),
        ]:
            with self.subTest(category=category), tempfile.TemporaryDirectory() as folder:
                device = FakeDevice(Path(folder), failure=message)
                with self.assertRaisesRegex(RendererFailure, category):
                    self.journey(device)
                self.assertNotIn("Solicitações", device.tabs)
                self.assertFalse((Path(folder) / "04-finance.png").exists())

    def test_original_prefix_captures_ten_private_phases_and_installs_both_apps(self):
        with tempfile.TemporaryDirectory() as folder:
            device = FakeDevice(Path(folder)); database = self.journey(device)
            self.assertEqual(len(device.steps), 10)
            self.assertEqual(len(list(Path(folder).glob("*.xml"))), 10)
            self.assertEqual(len(list(Path(folder).glob("*.png"))), 10)
            self.assertEqual(device.steps[-1]["phase"], "06-own-ticket")
            self.assertEqual(device.tabs, ["Transparência", "Solicitações"])
            self.assertEqual(device.inputs, ["Ver lançamentos (1)"])
            self.assertEqual([c for c in device.calls if c[0] == "install"], [
                ("install", "-r", str(Path("apks/resident-mobile/verification.apk"))),
                ("install", "-r", str(Path("apks/operations-mobile/verification.apk")))])
            self.assertEqual([c.args[1] for c in database.call_args_list], ["snapshot", "snapshot"])
            report = public_report(True, "passed", PID, device.markers, None, True, SOURCE)
            self.assertEqual(len(report["markers"]), 28)

    def test_home_failure_prevents_install_launch_database_and_collection(self):
        with tempfile.TemporaryDirectory() as folder:
            device = FakeDevice(Path(folder), home=True)
            with patch.object(prefix, "fixture_action") as database, patch.object(device, "collect") as collect:
                with self.assertRaises(RendererFailure):
                    prefix.run(device, Path("apks"), Path("fixture.json"))
                database.assert_not_called(); collect.assert_not_called()
            self.assertFalse(any(c[0] == "install" or c[:3] == ("shell", "am", "start") for c in device.calls))
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_privacy_negative_cannot_write_tree_image_or_next_gesture(self):
        with tempfile.TemporaryDirectory() as folder:
            device = FakeDevice(Path(folder)); device.monitor = RendererMonitor(PID)
            source = XML.replace('text="safe"', 'text="' + SECRET + '"')
            with self.assertRaises(prefix.PrivacyViolation):
                device.capture("04-finance", source)
            self.assertTrue(device.security_failed)
            before = len(device.calls)
            with self.assertRaisesRegex(RendererFailure, "privacy-rejected"):
                device.adb("shell", "input", "tap", "1", "2")
            self.assertEqual(len(device.calls), before)
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_first_native_negative_blocks_screen_and_raw_diagnostics_collector(self):
        with tempfile.TemporaryDirectory() as folder:
            device = FakeDevice(Path(folder)); device.monitor = RendererMonitor(PID); device.monitor.observe(native())
            with self.assertRaises(RendererFailure):
                device.screen("04-finance")
            device.collect()
            self.assertEqual(device.calls, []); self.assertEqual(list(Path(folder).iterdir()), [])

    def test_native_negative_during_screenshot_does_not_write_image_or_next_capture(self):
        with tempfile.TemporaryDirectory() as folder:
            device = FakeDevice(Path(folder)); device.monitor = RendererMonitor(PID); original = device.raw
            def raw(*args, **kwargs):
                if args[:2] == ("exec-out", "screencap"):
                    device.monitor.observe(native())
                return original(*args, **kwargs)
            with patch.object(device, "raw", side_effect=raw):
                with self.assertRaises(RendererFailure):
                    device.screen("04-finance")
                before = len(device.calls)
                with self.assertRaises(RendererFailure):
                    device.capture("05-finance-entry", XML)
                self.assertEqual(len(device.calls), before)
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_changed_pid_blocks_next_gesture(self):
        with tempfile.TemporaryDirectory() as folder:
            device = FakeDevice(Path(folder)); device.monitor = RendererMonitor(PID)
            with patch.object(device, "raw", return_value="9999") as raw:
                with self.assertRaisesRegex(RendererFailure, "process-changed"):
                    device.adb("shell", "input", "tap", "1", "2")
            self.assertEqual(raw.call_count, 1)

    def test_finance_capture_preserves_image_before_tree_and_stops_after_negative(self):
        for negative in [False, True]:
            with self.subTest(negative=negative), tempfile.TemporaryDirectory() as folder:
                directory = Path(folder); device = FakeDevice(directory); device.monitor = RendererMonitor(PID)
                def screenshot(phase):
                    self.assertFalse((directory / (phase + ".xml")).exists())
                    if negative:
                        device.monitor.observe(native())
                with patch.object(device, "screen", side_effect=screenshot) as screen:
                    if negative:
                        with self.assertRaisesRegex(RendererFailure, "renderer-missing-view-state"):
                            device.capture("04-finance", XML, image_first=True)
                        self.assertEqual(list(directory.iterdir()), [])
                        self.assertEqual(device.steps, [])
                    else:
                        device.capture("04-finance", XML, image_first=True)
                        self.assertEqual((directory / "04-finance.xml").read_text(), XML)
                        self.assertEqual(len(device.steps), 1)
                    screen.assert_called_once_with("04-finance")

    def test_capture_filename_cannot_escape_private_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            device = FakeDevice(Path(folder))
            for name in ["../public/result", SECRET, "04-finance/secret"]:
                with self.assertRaisesRegex(RendererFailure, "configuration-rejected"):
                    device.capture(name, XML)
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_final_domain_change_is_not_passed(self):
        with tempfile.TemporaryDirectory() as folder:
            device = FakeDevice(Path(folder))
            with patch.object(RendererMonitor, "start"), patch.object(prefix, "fixture_action", side_effect=[INITIAL, dict(INITIAL, residentCreated=1)]):
                with self.assertRaises(AssertionError):
                    prefix.run(device, Path("apks"), Path("fixture.json"))

    def test_native_failure_during_real_wait_inspection_blocks_xml_and_png(self):
        with tempfile.TemporaryDirectory() as folder:
            device = FakeDevice(Path(folder)); device.monitor = RendererMonitor(PID)
            def inspect(_source):
                device.monitor.observe(native())
            with patch.object(device, "hierarchy", return_value=XML), patch.object(device, "assert_no_crash"):
                with self.assertRaisesRegex(RendererFailure, "renderer-missing-view-state"):
                    device.wait_for("04-finance", inspect)
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_system_dialog_in_finance_is_terminal_without_scroll_retry(self):
        with tempfile.TemporaryDirectory() as folder:
            device = FakeDevice(Path(folder)); device.monitor = RendererMonitor(PID)
            with patch.object(device, "hierarchy", return_value=XML), patch.object(device, "assert_no_crash"), patch.object(prefix, "inspect_domain", side_effect=AssertionError("Android system dialog " + SECRET)), patch.object(device, "scroll") as scroll:
                with self.assertRaisesRegex(RendererFailure, "ui-incomplete"):
                    prefix.PrefixDevice.wait_statement(device, "04-finance", "Report")
                scroll.assert_not_called()
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_raw_adb_exception_does_not_include_arguments_or_private_output(self):
        with tempfile.TemporaryDirectory() as folder:
            device = FakeDevice(Path(folder))
            with patch.object(prefix.DomainDevice, "adb", side_effect=RuntimeError(SECRET)):
                with self.assertRaisesRegex(RendererFailure, "^adb-failed$") as error:
                    prefix.PrefixDevice.raw(device, "shell", "input", "text", SECRET)
            self.assertNotIn(SECRET, str(error.exception))

    def test_credential_negative_blocks_future_commands(self):
        with tempfile.TemporaryDirectory() as folder:
            device = FakeDevice(Path(folder)); device.monitor = RendererMonitor(PID)
            device.record_security_failure("credential-exposure")
            with self.assertRaisesRegex(RendererFailure, "credential-exposure"):
                device.adb("shell", "input", "text", "safe")
            self.assertEqual(device.calls, [])

    def source_tree(self, directory):
        for app in ["resident-mobile", "operations-mobile"]:
            (directory / app).mkdir()
        apk = directory / "operations-mobile/verification.apk"; apk.write_bytes(b"real peer bytes")
        metadata = {"app": "operations-mobile", "package": "com.predioon.operations", "gitSha": SOURCE["commit"],
                    "architecture": "x86_64", "mode": "release", "apiOrigin": "https://10.0.2.2:3443", "sha256": hashlib.sha256(apk.read_bytes()).hexdigest()}
        (apk.parent / "build.json").write_text(json.dumps(metadata))
        return apk, metadata

    def test_peer_apk_origin_is_checked_against_real_bytes_and_resident_commit(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder); self.source_tree(directory)
            with patch.object(prefix, "source_metadata", return_value=SOURCE) as resident:
                self.assertEqual(prefix.checked_source(directory), SOURCE)
                resident.assert_called_once_with(directory / "resident-mobile/verification.apk")

    def test_peer_metadata_cannot_forge_digest_commit_mode_package_or_origin(self):
        for key, value in [("sha256", "c" * 64), ("gitSha", "c" * 40), ("mode", "debug"), ("package", "com.other.app"),
                           ("architecture", "arm64"), ("apiOrigin", "http://localhost:3000")]:
            with self.subTest(key=key), tempfile.TemporaryDirectory() as folder:
                directory = Path(folder); apk, metadata = self.source_tree(directory)
                (apk.parent / "build.json").write_text(json.dumps(dict(metadata, **{key: value})))
                with patch.object(prefix, "source_metadata", return_value=SOURCE), self.assertRaises(RendererFailure):
                    prefix.checked_source(directory)

    def test_missing_or_empty_peer_apk_is_rejected(self):
        for empty in [True, False]:
            with tempfile.TemporaryDirectory() as folder:
                directory = Path(folder); apk, _ = self.source_tree(directory)
                apk.write_bytes(b"") if empty else apk.unlink()
                with patch.object(prefix, "source_metadata", return_value=SOURCE), self.assertRaises(RendererFailure):
                    prefix.checked_source(directory)

    def test_missing_or_oversize_peer_metadata_is_rejected(self):
        for oversized in [True, False]:
            with tempfile.TemporaryDirectory() as folder:
                directory = Path(folder); apk, _ = self.source_tree(directory); metadata = apk.parent / "build.json"
                metadata.write_text("x" * 65537) if oversized else metadata.unlink()
                with patch.object(prefix, "source_metadata", return_value=SOURCE), self.assertRaises(RendererFailure):
                    prefix.checked_source(directory)

    def test_invalid_cli_does_not_echo_private_arguments(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(prefix.main(["--private=" + SECRET, "--unknown=" + SECRET]), 1)
        report = json.loads(output.getvalue()); self.assertEqual(report["category"], "configuration-rejected")
        self.assertNotIn(SECRET, output.getvalue())

    def test_failure_output_is_closed_and_public_directory_has_only_result(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder); private = base / "private"; private.mkdir(); public = base / "public"
            (private / "fixture.json").write_text(json.dumps(fixture()))
            env = {"CI": "true", "GITHUB_ACTIONS": "true", "ANDROID_RENDERER_DISPOSABLE_DB": "1",
                   "ANDROID_DOMAIN_DISPOSABLE_DB": "1", "RUNNER_TEMP": str(base), "ANDROID_AUTH_PASSWORD": "A" * 32}
            output = io.StringIO()
            with patch.dict(os.environ, env), patch.object(prefix, "checked_source", return_value=SOURCE), patch.object(prefix, "run", side_effect=RuntimeError(SECRET)), contextlib.redirect_stdout(output):
                self.assertEqual(prefix.main(["--private", str(private), "--public", str(public)]), 1)
            report = json.loads((public / "result.json").read_text())
            self.assertEqual(report["category"], "harness-failed")
            self.assertEqual(set(report), {"schema", "app", "passed", "category", "pid", "markers", "firstFailure", "domainSnapshotUnchanged", "source"})
            self.assertEqual([p.name for p in public.iterdir()], ["result.json"])
            self.assertNotIn(SECRET, output.getvalue()); self.assertNotIn(SECRET, json.dumps(report))

    def main_fixture(self, base):
        private = base / "private"; private.mkdir(); public = base / "public"
        (private / "fixture.json").write_text(json.dumps(fixture()))
        env = {"CI": "true", "GITHUB_ACTIONS": "true", "ANDROID_RENDERER_DISPOSABLE_DB": "1",
               "ANDROID_DOMAIN_DISPOSABLE_DB": "1", "RUNNER_TEMP": str(base), "ANDROID_AUTH_PASSWORD": "A" * 32}
        return private, public, env

    def test_success_exports_only_closed_result_with_real_runner_flow(self):
        with tempfile.TemporaryDirectory() as folder:
            private, public, env = self.main_fixture(Path(folder)); output = io.StringIO()
            with patch.dict(os.environ, env), patch.object(prefix, "checked_source", return_value=SOURCE), patch.object(prefix, "PrefixDevice", side_effect=lambda serial, directory, data, password: FakeDevice(directory)), patch.object(RendererMonitor, "start"), patch.object(prefix, "fixture_action", return_value=INITIAL), contextlib.redirect_stdout(output):
                self.assertEqual(prefix.main(["--private", str(private), "--public", str(public)]), 0)
            report = json.loads((public / "result.json").read_text())
            self.assertTrue(report["passed"]); self.assertTrue(report["domainSnapshotUnchanged"])
            self.assertEqual(report["source"], SOURCE); self.assertEqual(len(report["markers"]), 28)
            self.assertEqual([p.name for p in public.iterdir()], ["result.json"])
            self.assertEqual(len(list((private / "ui-private").glob("*.png"))), 10)
            self.assertNotIn(SECRET, output.getvalue())

    def test_late_native_failure_at_finish_cannot_export_success(self):
        with tempfile.TemporaryDirectory() as folder:
            private, public, env = self.main_fixture(Path(folder)); output = io.StringIO()
            def finish(monitor):
                monitor.observe(native())
                monitor.check()
            with patch.dict(os.environ, env), patch.object(prefix, "checked_source", return_value=SOURCE), patch.object(prefix, "PrefixDevice", side_effect=lambda serial, directory, data, password: FakeDevice(directory)), patch.object(RendererMonitor, "start"), patch.object(prefix, "fixture_action", return_value=INITIAL), patch.object(prefix, "finish_monitor", side_effect=finish), contextlib.redirect_stdout(output):
                self.assertEqual(prefix.main(["--private", str(private), "--public", str(public)]), 1)
            report = json.loads((public / "result.json").read_text())
            self.assertFalse(report["passed"]); self.assertFalse(report["domainSnapshotUnchanged"])
            self.assertEqual(report["category"], "renderer-missing-view-state")
            self.assertEqual(report["firstFailure"]["category"], "renderer-missing-view-state")

    def failure_order(self, initial, later):
        with tempfile.TemporaryDirectory() as folder:
            private, public, env = self.main_fixture(Path(folder)); output = io.StringIO(); devices = []
            def reject(device, _apks, _fixture):
                devices.append(device)
                device.monitor = RendererMonitor(PID)
                if initial == "native":
                    device.monitor.observe(native())
                device.record_security_failure("credential-exposure" if initial == "credential" else "private-domain-content")
                raise prefix.PrivacyViolation(SECRET)
            def finish(monitor):
                if later == "native":
                    monitor.observe(native())
                elif later == "diagnostic":
                    monitor.fail("diagnostic-stream-failed")
                monitor.check()
            with patch.dict(os.environ, env), patch.object(prefix, "checked_source", return_value=SOURCE), patch.object(prefix, "run", side_effect=reject), patch.object(prefix, "finish_monitor", side_effect=finish), contextlib.redirect_stdout(output):
                self.assertEqual(prefix.main(["--private", str(private), "--public", str(public)]), 1)
            report = json.loads((public / "result.json").read_text())
            self.assertFalse(report["passed"]); self.assertFalse(report["domainSnapshotUnchanged"])
            self.assertEqual([p.name for p in public.iterdir()], ["result.json"])
            self.assertEqual(list((private / "ui-private").iterdir()), [])
            self.assertNotIn(SECRET, json.dumps(report)); self.assertNotIn(SECRET, output.getvalue())
            self.assertEqual(devices[0].steps, [])
            return report

    def test_privacy_before_late_native_failure_preserves_first_category(self):
        report = self.failure_order("privacy", "native")
        self.assertEqual(report["category"], "privacy-rejected")
        self.assertEqual(report["firstFailure"], {"category": "privacy-rejected", "deviceTime": None})

    def test_native_before_privacy_preserves_first_category(self):
        report = self.failure_order("native", None)
        self.assertEqual(report["category"], "renderer-missing-view-state")
        self.assertEqual(report["firstFailure"], {"category": "renderer-missing-view-state", "deviceTime": "1791065526.176"})

    def test_credential_before_cleanup_diagnostic_preserves_first_category(self):
        report = self.failure_order("credential", "diagnostic")
        self.assertEqual(report["category"], "credential-exposure")
        self.assertEqual(report["firstFailure"], {"category": "credential-exposure", "deviceTime": None})

    def test_privacy_without_later_failure_is_recorded_immediately(self):
        report = self.failure_order("privacy", None)
        self.assertEqual(report["category"], "privacy-rejected")
        self.assertEqual(report["firstFailure"], {"category": "privacy-rejected", "deviceTime": None})

    def test_source_failure_prevents_device_construction_and_private_capture(self):
        with tempfile.TemporaryDirectory() as folder:
            private, public, env = self.main_fixture(Path(folder)); output = io.StringIO()
            with patch.dict(os.environ, env), patch.object(prefix, "checked_source", side_effect=RendererFailure("configuration-rejected")), patch.object(prefix, "PrefixDevice") as constructor, contextlib.redirect_stdout(output):
                self.assertEqual(prefix.main(["--private", str(private), "--public", str(public)]), 1)
                constructor.assert_not_called()
            self.assertFalse((private / "ui-private").exists())
            self.assertEqual([p.name for p in public.iterdir()], ["result.json"])


if __name__ == "__main__":
    unittest.main()
