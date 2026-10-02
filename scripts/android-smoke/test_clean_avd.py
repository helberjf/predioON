import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from clean_avd import SETTINGS, build_metadata, check_clean_environment, main, require_health
from run import Device

EMULATOR = "Pkg.Revision=37.2.12\nPkg.BuildId=16428233\nPkg.Path=emulator\n"
IMAGE = "Pkg.Revision=9\nAndroidVersion.ApiLevel=35\nSystemImage.Abi=x86_64\nSystemImage.TagId=google_apis\n"
HOST = {"os": "Linux", "arch": "x86_64", "image": "ubuntu24", "imageVersion": "20260928.1", "cpu": "vendor=model features"}


class CleanAvdTests(unittest.TestCase):
    def test_changed_package_fingerprint_is_rejected_before_device_creation(self):
        metadata = build_metadata(EMULATOR, IMAGE, HOST, SETTINGS)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            saved = path / "metadata.json"
            saved.write_text(json.dumps(metadata))
            changed = build_metadata(EMULATOR, IMAGE.replace("Revision=9", "Revision=10"), HOST, SETTINGS)
            argv = ["clean_avd.py", "check", "--sdk", str(path), "--metadata", str(saved), "--artifacts", str(path / "output")]
            with patch("clean_avd.installed_metadata", return_value=changed), patch("clean_avd.Device") as device, patch("sys.argv", argv):
                with self.assertRaisesRegex(SystemExit, "changed"):
                    main()
                device.assert_not_called()

    def test_incomplete_boot_wrong_timezone_and_unstable_home_never_pass(self):
        metadata = build_metadata(EMULATOR, IMAGE, HOST, SETTINGS)
        stable = [{"ready": True, "homeComponent": "com.android.launcher/.Launcher"}] * 2
        for boot, zone, offset, attempts, home_error in [("0", "Etc/UTC", "+0000", stable, None), ("1", "America/Sao_Paulo", "-0300", stable, None), ("1", "Etc/UTC", "+0100", stable, None), ("1", "Etc/UTC", "+0000", [], None), ("1", "Etc/UTC", "+0000", [stable[0], {"ready": True, "homeComponent": "com.setup/.Setup"}], None), ("1", "Etc/UTC", "+0000", stable, AssertionError("HOME permanently unavailable")), ("1", "Etc/UTC", "+0000", stable, RuntimeError("ADB failed"))]:
            device = Device("emulator-test", "resident-mobile", Path("unused"))
            device.environment_attempts = attempts
            def adb(*args):
                if args[:2] == ("shell", "getprop"):
                    return {"ro.kernel.qemu": "1", "sys.boot_completed": boot, "persist.sys.timezone": zone}[args[2]]
                return offset if args[:2] == ("shell", "date") else ""
            with tempfile.TemporaryDirectory() as workspace, patch.dict("clean_avd.os.environ", {"CI": "true"}, clear=True), patch.object(device, "adb", side_effect=adb), patch.object(device, "wait_environment_ready", side_effect=home_error):
                with self.assertRaises((AssertionError, RuntimeError)):
                    check_clean_environment(device, metadata, Path(workspace))

    def test_cli_never_collects_ui_or_logs_from_refused_credentials_physical_device_or_installed_app(self):
        metadata = build_metadata(EMULATOR, IMAGE, HOST, SETTINGS)
        scenarios = [({}, "1", ""), ({"CI": "true", "ANDROID_AUTH_PASSWORD": "never-export-this"}, "1", ""), ({"CI": "true"}, "0", ""), ({"CI": "true"}, "1", "package:com.predioon.resident")]
        for env, qemu, packages in scenarios:
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory)
                saved = path / "metadata.json"
                saved.write_text(json.dumps(metadata))
                output = path / "evidence"
                device = Device("emulator-test", "resident-mobile", output)
                def adb(*args):
                    if args == ("shell", "getprop", "ro.kernel.qemu"):
                        return qemu
                    if args[:3] == ("shell", "pm", "list"):
                        return packages
                    return "1"
                argv = ["clean_avd.py", "check", "--sdk", str(path), "--metadata", str(saved), "--artifacts", str(output)]
                with patch.dict("clean_avd.os.environ", env, clear=True), patch("clean_avd.ROOT", path), patch("clean_avd.installed_metadata", return_value=metadata), patch("clean_avd.Device", return_value=device), patch("sys.argv", argv), patch.object(device, "adb", side_effect=adb) as command, patch.object(device, "collect") as collect:
                    with self.assertRaises(SystemExit):
                        main()
                    collect.assert_not_called()
                    self.assertFalse(json.loads((output / "clean-health.json").read_text())["passed"])
                    allowed = [("shell", "getprop", "ro.kernel.qemu"), ("shell", "pm", "list", "packages", "-u", "com.predioon")]
                    self.assertTrue(all(call.args in allowed for call in command.call_args_list))
                    if not env.get("CI") or env.get("ANDROID_AUTH_PASSWORD"):
                        command.assert_not_called()

    def test_fingerprint_is_stable_and_changes_with_each_compatibility_input(self):
        original = build_metadata(EMULATOR, IMAGE, HOST, SETTINGS)
        reordered_host = dict(reversed(list(HOST.items())))
        self.assertEqual(original, build_metadata(EMULATOR, IMAGE, reordered_host, dict(reversed(list(SETTINGS.items())))))
        candidates = [build_metadata(EMULATOR.replace("37.2.12", "37.2.13"), IMAGE, HOST, SETTINGS), build_metadata(EMULATOR, IMAGE.replace("Revision=9", "Revision=10"), HOST, SETTINGS)]
        for field, value in [("cores", 2), ("ramMiB", 2048), ("gpu", "host"), ("timezone", "America/Sao_Paulo"), ("schemaVersion", 2)]:
            candidates.append(build_metadata(EMULATOR, IMAGE, HOST, {**SETTINGS, field: value}))
        for field, value in [("imageVersion", "next"), ("cpu", "different cpu"), ("arch", "arm64")]:
            candidates.append(build_metadata(EMULATOR, IMAGE, {**HOST, field: value}, SETTINGS))
        self.assertTrue(all(candidate["cacheKey"] != original["cacheKey"] for candidate in candidates))

    def test_incomplete_or_inconsistent_package_metadata_is_refused(self):
        for emulator, image in [("", IMAGE), (EMULATOR, "Pkg.Revision=9"), (EMULATOR, IMAGE.replace("ApiLevel=35", "ApiLevel=34")), (EMULATOR, IMAGE.replace("google_apis", "aosp_atd")), (EMULATOR, IMAGE.replace("x86_64", "arm64-v8a")), (EMULATOR + "Pkg.Revision=bad\n", IMAGE)]:
            with self.assertRaises(ValueError):
                build_metadata(emulator, image, HOST, SETTINGS)

    def test_healthy_home_without_app_packages_produces_exact_health_proof(self):
        metadata = build_metadata(EMULATOR, IMAGE, HOST, SETTINGS)
        device = Device("emulator-test", "resident-mobile", Path("unused"))
        device.environment_attempts = [{"ready": True, "homeComponent": "com.android.launcher/.Launcher"}] * 2
        def adb(*args):
            if args[:2] == ("shell", "getprop"):
                return "Etc/UTC" if args[2] == "persist.sys.timezone" else "1"
            if args[:2] == ("shell", "date"):
                return "+0000"
            return ""
        with tempfile.TemporaryDirectory() as workspace, patch.dict("clean_avd.os.environ", {"CI": "true"}, clear=True), patch.object(device, "adb", side_effect=adb) as command, patch.object(device, "wait_environment_ready"):
            result = check_clean_environment(device, metadata, Path(workspace))
        require_health(result, metadata)
        self.assertFalse(any("install" in call.args or "input" in call.args or "clear" in call.args for call in command.call_args_list))

    def test_preparation_is_refused_before_adb_if_test_credentials_or_fixture_already_exist(self):
        metadata = build_metadata(EMULATOR, IMAGE, HOST, SETTINGS)
        device = Device("emulator-test", "resident-mobile", Path("unused"))
        with tempfile.TemporaryDirectory() as workspace:
            root = Path(workspace)
            for env in [{}, {"CI": "true", "ANDROID_AUTH_PASSWORD": "never-export-this"}]:
                with patch.dict("clean_avd.os.environ", env, clear=True), patch.object(device, "adb") as command:
                    with self.assertRaisesRegex(ValueError, "before|CI"):
                        check_clean_environment(device, metadata, root)
                    command.assert_not_called()
            directory = root / ".local/android-auth"
            directory.mkdir(parents=True)
            (directory / "fixture.json").write_text("{}")
            with patch.dict("clean_avd.os.environ", {"CI": "true"}, clear=True), patch.object(device, "adb") as command:
                with self.assertRaisesRegex(ValueError, "before"):
                    check_clean_environment(device, metadata, root)
                command.assert_not_called()

    def test_anr_crash_app_package_and_adb_failure_cannot_produce_a_health_proof(self):
        metadata = build_metadata(EMULATOR, IMAGE, HOST, SETTINGS)
        device = Device("emulator-test", "resident-mobile", Path("unused"))
        device.environment_attempts = [{"ready": True, "homeComponent": "com.android.launcher/.Launcher"}] * 2
        for packages, crash, log, failure in [("package:com.predioon.resident", "", "", None), ("", "FATAL EXCEPTION", "", None), ("", "", "ANR in com.android.launcher", None), ("", "", "", RuntimeError("ADB failed"))]:
            def adb(*args):
                if failure:
                    raise failure
                if args[:2] == ("shell", "getprop"):
                    return "Etc/UTC" if args[2] == "persist.sys.timezone" else "1"
                if args[:2] == ("shell", "date"):
                    return "+0000"
                if args[:3] == ("shell", "pm", "list"):
                    return packages
                return crash if "crash" in args else log
            with tempfile.TemporaryDirectory() as workspace, patch.dict("clean_avd.os.environ", {"CI": "true"}, clear=True), patch.object(device, "adb", side_effect=adb), patch.object(device, "wait_environment_ready"):
                with self.assertRaises((AssertionError, RuntimeError)):
                    check_clean_environment(device, metadata, Path(workspace))

    def test_health_is_rejected_for_other_fingerprint_missing_checks_or_failed_preparation(self):
        metadata = build_metadata(EMULATOR, IMAGE, HOST, SETTINGS)
        good = {"passed": True, "cacheKey": metadata["cacheKey"], "checks": {"emulator": True, "bootCompleted": True, "timezone": "Etc/UTC", "homeComponent": "com.android.launcher/.Launcher", "stableObservations": 2, "productPackagesAbsent": True, "diagnosticsClean": True}}
        require_health(good, metadata)
        variants = [{**good, "passed": False}, {**good, "cacheKey": "other"}]
        variants.extend([[], {**good, "checks": None}, {**good, "checks": {**good["checks"], "emulator": 1}}, {**good, "checks": {**good["checks"], "stableObservations": 2.0}}, {**good, "checks": {**good["checks"], "homeComponent": None}}])
        for field in good["checks"]:
            invalid = copy.deepcopy(good)
            del invalid["checks"][field]
            variants.append(invalid)
        for invalid in variants:
            with self.assertRaises(ValueError):
                require_health(invalid, metadata)


if __name__ == "__main__":
    unittest.main()
