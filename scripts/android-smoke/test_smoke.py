import unittest
from pathlib import Path
from unittest.mock import patch
import xml.etree.ElementTree as ET

from prepare import configure_source, validate_badging, AUTH_ORIGIN, SMOKE_ORIGIN
from run import APPS, Device, EMAIL, PASSWORD, center, crash_evidence, inspect_login, run_smoke


def hierarchy(app="resident-mobile", email="", password="", enabled="false", secure="true"):
    package, title = APPS[app]
    root = ET.Element("hierarchy")
    common = {"package": package, "bounds": "[10,20][110,80]", "enabled": "true", "clickable": "false"}
    ET.SubElement(root, "node", {**common, "class": "android.widget.TextView", "text": title})
    ET.SubElement(root, "node", {**common, "class": "android.widget.TextView", "text": "Entrar"})
    ET.SubElement(root, "node", {**common, "class": "android.widget.EditText", "content-desc": "E-mail", "text": email})
    ET.SubElement(root, "node", {**common, "class": "android.widget.EditText", "content-desc": "Senha", "text": password, "password": secure})
    ET.SubElement(root, "node", {**common, "class": "android.widget.Button", "content-desc": "Entrar", "enabled": enabled})
    return ET.tostring(root, encoding="unicode")


class UiAssertions(unittest.TestCase):
    def test_product_specific_login_and_field_state_for_both_apps(self):
        for app in APPS:
            inspect_login(hierarchy(app), app)
            inspect_login(hierarchy(app, email=EMAIL), app, email=EMAIL)
            for hidden in ["", "••••••••"]:
                fields = inspect_login(hierarchy(app, EMAIL, hidden, "true"), app, EMAIL, True)
                self.assertEqual(center(fields["email"]), ("60", "50"))

    def test_rejects_wrong_product_and_a_crash_dialog_hierarchy(self):
        with self.assertRaises(AssertionError):
            inspect_login(hierarchy("operations-mobile"), "resident-mobile")
        with self.assertRaises(AssertionError):
            inspect_login('<hierarchy><node package="android" text="App keeps stopping" /></hierarchy>', "resident-mobile")

    def test_rejects_wrong_field_value_button_state_and_password_leak(self):
        for xml, args in [
            (hierarchy(email="another@example.invalid"), {}),
            (hierarchy(enabled="true"), {}),
            (hierarchy(secure="false"), {}),
            (hierarchy(email=EMAIL, password=PASSWORD, enabled="true"), {"email": EMAIL, "filled_password": True}),
            (hierarchy(password="••"), {}),
        ]:
            with self.subTest(xml=xml), self.assertRaises(AssertionError):
                inspect_login(xml, "resident-mobile", **args)

    def test_rejects_ambiguous_controls_and_invisible_bounds(self):
        root = ET.fromstring(hierarchy())
        root.append(ET.fromstring(ET.tostring(root[-1])))
        with self.assertRaises(AssertionError):
            inspect_login(ET.tostring(root, encoding="unicode"), "resident-mobile")
        for bounds in ["", "[20,20][20,80]", "[100,100][0,0]", "not-bounds"]:
            with self.subTest(bounds=bounds), self.assertRaises(AssertionError):
                center(ET.Element("node", {"bounds": bounds}))


class CrashAssertions(unittest.TestCase):
    def test_home_resolution_follows_first_boot_setup_transition(self):
        device = Device("emulator-test", "resident-mobile", Path("unused"))
        setup = "com.google.android.googlesdksetup/.DefaultActivity"
        launcher = "com.google.android.apps.nexuslauncher/.NexusLauncherActivity"
        resolutions = iter([setup, launcher, launcher])
        home = '<hierarchy><node package="com.google.android.apps.nexuslauncher" /></hierarchy>'
        def adb(*args):
            return next(resolutions) + "\n" if "resolve-activity" in args else ""
        with patch.object(device, "adb", side_effect=adb) as command, patch.object(device, "hierarchy", return_value=home), patch("run.time.monotonic", side_effect=[0, 1, 5, 9, 91]), patch("run.time.sleep"):
            device.wait_environment_ready()
        self.assertEqual([attempt["homeComponent"] for attempt in device.environment_attempts], [setup, launcher, launcher])
        self.assertEqual([attempt["ready"] for attempt in device.environment_attempts], [False, True, True])
        self.assertEqual(sum("start" in call.args for call in command.call_args_list), 1)
        self.assertFalse(any("install" in call.args or "input" in call.args for call in command.call_args_list))

    def test_two_ready_observations_must_use_the_same_current_home_component(self):
        device = Device("emulator-test", "resident-mobile", Path("unused"))
        old, new = "com.android.launcher/.OldHome", "com.android.launcher/.NewHome"
        resolutions = iter([old, new, new])
        home = '<hierarchy><node package="com.android.launcher" /></hierarchy>'
        with patch.object(device, "adb", side_effect=lambda *args: next(resolutions) if "resolve-activity" in args else "") as command, patch.object(device, "hierarchy", return_value=home) as dump, patch("run.time.sleep"):
            device.wait_environment_ready()
        self.assertEqual(dump.call_count, 3)
        self.assertEqual([attempt["homeComponent"] for attempt in device.environment_attempts], [old, new, new])
        self.assertEqual(sum(call.args[0] == "logcat" for call in command.call_args_list), 3)

    def test_home_readiness_waits_for_accessibility_before_installing_the_app(self):
        device = Device("emulator-test", "resident-mobile", Path("unused"))
        home = '<hierarchy><node package="com.android.launcher" /></hierarchy>'
        def adb(*args):
            return "com.android.launcher/.Launcher\n" if "resolve-activity" in args else ""
        with patch.object(device, "adb", side_effect=adb) as command, patch.object(device, "hierarchy", side_effect=[AssertionError("UIAutomator did not produce a hierarchy"), home, home]) as dump, patch("run.time.sleep"):
            device.wait_environment_ready()
            self.assertEqual(dump.call_count, 3)
            self.assertEqual(sum(call.args[0] == "logcat" for call in command.call_args_list), 2)
            self.assertFalse(any("install" in call.args or "input" in call.args for call in command.call_args_list))
            self.assertEqual([attempt["ready"] for attempt in device.environment_attempts], [False, True, True])
            self.assertIn("did not produce", device.environment_attempts[0]["error"])

    def test_permanent_missing_home_expires_and_preserves_every_attempt(self):
        device = Device("emulator-test", "resident-mobile", Path("unused"))
        device.last_hierarchy_output = {"exitCode": 0, "stdout": "", "stderr": "ERROR: could not get idle state."}
        with patch.object(device, "adb", return_value="com.android.launcher/.Launcher\n") as command, patch.object(device, "hierarchy", side_effect=AssertionError("UIAutomator did not produce a hierarchy")), patch("run.time.monotonic", side_effect=[0, 1, 45, 91]), patch("run.time.sleep"):
            with self.assertRaisesRegex(AssertionError, "HOME did not become ready"):
                device.wait_environment_ready()
            self.assertEqual(len(device.environment_attempts), 2)
            self.assertTrue(all(not attempt["ready"] and attempt["hierarchyCommand"]["stderr"] == "ERROR: could not get idle state." for attempt in device.environment_attempts))
            self.assertFalse(any("install" in call.args or "input" in call.args for call in command.call_args_list))

    def test_missing_dump_preserves_zero_exit_stderr_and_never_reads_a_previous_xml(self):
        device = Device("emulator-test", "resident-mobile", Path("unused"))
        result = type("Result", (), {"returncode": 0, "stdout": b"", "stderr": b"ERROR: null root node returned by UiTestAutomationBridge."})()
        with patch("run.subprocess.run", return_value=result) as command:
            with self.assertRaisesRegex(AssertionError, "null root node"):
                device.hierarchy()
            self.assertEqual(command.call_count, 1)
            self.assertEqual(device.last_hierarchy_output["exitCode"], 0)
            self.assertIn("null root node", device.last_hierarchy_output["stderr"])

    def test_nonzero_adb_dump_aborts_readiness_without_another_observation(self):
        device = Device("emulator-test", "resident-mobile", Path("unused"))
        def execute(command, **_kwargs):
            if "resolve-activity" in command:
                return type("Result", (), {"returncode": 0, "stdout": b"com.android.launcher/.Launcher\n", "stderr": b""})()
            if "uiautomator" in command:
                return type("Result", (), {"returncode": 1, "stdout": b"partial dump", "stderr": b"transport disconnected"})()
            return type("Result", (), {"returncode": 0, "stdout": b"", "stderr": b""})()
        with patch("run.subprocess.run", side_effect=execute) as command, patch("run.time.sleep") as sleep:
            with self.assertRaisesRegex(RuntimeError, "exit 1"):
                device.wait_environment_ready()
            self.assertEqual(sum("uiautomator" in call.args[0] for call in command.call_args_list), 1)
            self.assertEqual(len(device.environment_attempts), 1)
            self.assertEqual(device.last_adb_failure["stdout"], "partial dump")
            self.assertEqual(device.environment_attempts[0]["hierarchyCommand"]["stderr"], "transport disconnected")
            sleep.assert_not_called()

    def test_emulator_launcher_readiness_needs_two_observations_and_complete_diagnostics(self):
        device = Device("emulator-test", "resident-mobile", Path("unused"))
        def adb(*args):
            return "com.android.launcher/.Launcher\n" if "resolve-activity" in args else ""
        home = '<hierarchy><node package="com.android.launcher" /></hierarchy>'
        with patch.object(device, "adb", side_effect=adb) as command, patch.object(device, "hierarchy", return_value=home) as dump, patch("run.time.sleep"):
            device.wait_environment_ready()
            self.assertEqual(dump.call_count, 2)
            self.assertEqual(sum(call.args[0] == "logcat" for call in command.call_args_list), 2)
        with patch.object(device, "adb", side_effect=lambda *args: adb(*args) if args[0] != "logcat" else (_ for _ in ()).throw(RuntimeError("Diagnostic read failed"))), patch.object(device, "hierarchy", return_value=home):
            with self.assertRaisesRegex(RuntimeError, "Diagnostic read failed"):
                device.wait_environment_ready()

    def test_launcher_anr_is_reported_as_blocking_environment_without_dismissing_it(self):
        device = Device("emulator-test", "operations-mobile", Path("unused"))
        source = '<hierarchy><node package="android" resource-id="android:id/alertTitle" text="Pixel Launcher is not responding" /></hierarchy>'
        with patch.object(device, "adb", return_value="com.android.launcher/.Launcher\n") as command, patch.object(device, "hierarchy", return_value=source):
            with self.assertRaisesRegex(AssertionError, "environment failed.*Pixel Launcher"):
                device.wait_environment_ready()
            self.assertFalse(any("input" in call.args or "install" in call.args for call in command.call_args_list))

    def test_adb_failure_retains_full_diagnostics_and_exit_code(self):
        device = Device("emulator-test", "resident-mobile", Path("unused"))
        result = type("Result", (), {"returncode": 1, "stdout": b"partial diagnostic output", "stderr": b""})()
        with patch("run.subprocess.run", return_value=result):
            with self.assertRaisesRegex(RuntimeError, "exit 1, stdout 25 bytes"):
                device.adb("logcat", "-d", "-v", "threadtime")
        self.assertEqual(device.last_adb_failure, {"command": ["logcat", "-d", "-v"], "exitCode": 1, "stdout": "partial diagnostic output", "stderr": ""})

    def test_detects_java_native_and_anr_evidence(self):
        package = APPS["resident-mobile"][0]
        samples = [
            (f"FATAL EXCEPTION main\nProcess: {package}, PID: 82", "", ""),
            ("", f"Fatal signal 11 in ({package})", ""),
            ("", f"ANR in {package}", ""),
            ("", "", "reason=4 (CRASH)"),
            ("", "", "reason=5 (CRASH_NATIVE)"),
            ("", "", "reason=6 (ANR)"),
        ]
        for sample in samples:
            with self.subTest(sample=sample):
                self.assertIsNotNone(crash_evidence(package, *sample))

    def test_ignores_other_apps_and_the_deliberate_force_stop(self):
        self.assertIsNone(crash_evidence(APPS["resident-mobile"][0], "Process: com.unrelated.app", "Activity resumed", "reason=10 (USER_REQUESTED)"))

    def test_refuses_a_physical_device_before_install_or_data_clear(self):
        class PhysicalDevice:
            calls = []
            def adb(self, *args):
                self.calls.append(args)
                return "0"
        device = PhysicalDevice()
        with self.assertRaisesRegex(AssertionError, "disposable emulator"):
            run_smoke(device, "unused.apk")
        self.assertEqual(device.calls, [("shell", "getprop", "ro.kernel.qemu")])


class PreparationAssertions(unittest.TestCase):
    def test_overrides_only_one_known_literal_origin(self):
        for origin in ["", "https://configured.example.invalid"]:
            result = configure_source(f'const PRODUCTION_API_URL = "{origin}";\nexport const OTHER = true;')
            self.assertIn(SMOKE_ORIGIN, result)
            self.assertTrue(result.endswith("export const OTHER = true;"))
        for source in ["", 'const PRODUCTION_API_URL = getOrigin();', 'const PRODUCTION_API_URL = "";\nconst PRODUCTION_API_URL = "";']:
            with self.assertRaises(ValueError):
                configure_source(source)

    def test_requires_matching_release_package_and_emulator_abi(self):
        package = APPS["resident-mobile"][0]
        source = f"package: name='{package}' versionCode='1'\nnative-code: 'x86_64'\n"
        validate_badging(source, package)
        for invalid in [source.replace(package, "com.other"), source.replace("x86_64", "arm64-v8a"), source + "application-debuggable"]:
            with self.assertRaises(ValueError):
                validate_badging(invalid, package)

    def test_authentication_uses_only_the_fixed_isolated_https_origin(self):
        source = 'const PRODUCTION_API_URL = "";'
        self.assertIn(AUTH_ORIGIN, configure_source(source, AUTH_ORIGIN))
        for origin in ["http://10.0.2.2:3443", "https://production.example.com", "https://10.0.2.2:3443/other"]:
            with self.assertRaises(ValueError):
                configure_source(source, origin)


if __name__ == "__main__":
    unittest.main()
