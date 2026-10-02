import unittest
import xml.etree.ElementTree as ET

from prepare import configure_source, validate_badging, SMOKE_ORIGIN
from run import APPS, EMAIL, PASSWORD, center, crash_evidence, inspect_login, run_smoke


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


if __name__ == "__main__":
    unittest.main()
