import copy
import json
from pathlib import Path
import tempfile
import unittest

from avd_snapshot import checked_config, seal_snapshot, verify_snapshot, require_restored_boot
from clean_avd import SETTINGS, build_metadata
from test_clean_avd import EMULATOR, IMAGE, HOST

CONFIG = "abi.type=x86_64\nhw.cpu.arch=x86_64\nhw.cpu.ncore=2\nhw.cpu.ncore=4\nhw.ramSize=2048\nhw.ramSize=4096M\nhw.device.name=pixel_6\nimage.sysdir.1=system-images/android-35/google_apis/x86_64/\ntag.id=google_apis\ntarget=android-35\n"
BOOT = "11111111-1111-4111-8111-111111111111"


class SnapshotTests(unittest.TestCase):
    def fixture(self, root):
        metadata = build_metadata(EMULATOR, IMAGE, HOST, SETTINGS)
        avd = root / "predioon-clean.avd"
        snapshots = avd / "snapshots/default_boot"
        snapshots.mkdir(parents=True)
        (avd / "config.ini").write_text(checked_config(CONFIG, SETTINGS))
        (snapshots / "snapshot.pb").write_bytes(b"snapshot test metadata")
        (snapshots / "ram.img").write_bytes(b"snapshot test RAM")
        (avd / "userdata-qemu.img.qcow2").write_bytes(b"clean image")
        (root / "predioon-clean.ini").write_text(f"path={avd}\ntarget=android-35\n")
        health = {"passed": True, "cacheKey": metadata["cacheKey"], "checks": {"emulator": True, "bootCompleted": True, "timezone": "Etc/UTC", "homeComponent": "com.android.launcher/.Launcher", "stableObservations": 2, "productPackagesAbsent": True, "diagnosticsClean": True}, "bootId": BOOT, "adbPublicKeySha256": "a" * 64}
        return metadata, avd, health

    def test_action_duplicate_cpu_ram_entries_are_canonicalized_but_wrong_effective_config_is_refused(self):
        canonical = checked_config(CONFIG, SETTINGS)
        self.assertEqual(canonical.count("hw.cpu.ncore="), 1)
        self.assertEqual(canonical.count("hw.ramSize="), 1)
        self.assertEqual(checked_config(canonical, SETTINGS), canonical)
        for old, new in [("hw.cpu.ncore=4", "hw.cpu.ncore=2"), ("4096M", "2048M"), ("pixel_6", "pixel_7"), ("image.sysdir.1=system-images/", "image.sysdir.1=../system-images/"), ("tag.id=google_apis", "tag.id=default")]:
            with self.assertRaises(ValueError):
                checked_config(CONFIG.replace(old, new), SETTINGS)

    def test_sdk_absolute_image_path_is_normalized_but_another_image_directory_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            sdk = Path(directory) / "sdk"
            image = sdk / "system-images/android-35/google_apis/x86_64"
            image.mkdir(parents=True)
            relative = "system-images/android-35/google_apis/x86_64/"
            absolute = CONFIG.replace(relative, str(image) + "/")
            self.assertEqual(checked_config(absolute, SETTINGS, sdk), checked_config(CONFIG, SETTINGS, sdk))
            for wrong in [sdk / "system-images/android-35/default/x86_64", Path(directory) / "foreign/google_apis/x86_64"]:
                wrong.mkdir(parents=True)
                with self.assertRaisesRegex(ValueError, "image.sysdir.1"):
                    checked_config(CONFIG.replace(relative, str(wrong) + "/"), SETTINGS, sdk)

    def test_seal_requires_healthy_proof_and_snapshot_files_and_verifies_every_cached_byte(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            metadata, avd, health = self.fixture(root)
            manifest = seal_snapshot(root, metadata, health)
            verify_snapshot(root, metadata, manifest)
            (avd / "userdata-qemu.img.qcow2").write_bytes(b"changed data")
            with self.assertRaisesRegex(ValueError, "contents"):
                verify_snapshot(root, metadata, manifest)
            for invalid in [{**health, "passed": False}, {**health, "cacheKey": "other"}]:
                with self.assertRaises(ValueError):
                    seal_snapshot(root, metadata, invalid)
            (avd / "snapshots/default_boot/snapshot.pb").unlink()
            with self.assertRaisesRegex(ValueError, "snapshot"):
                seal_snapshot(root, metadata, health)

    def test_extra_files_and_redirected_avd_paths_are_never_treated_as_the_cached_clean_avd(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            metadata, avd, health = self.fixture(root)
            manifest = seal_snapshot(root, metadata, health)
            (avd / "extra.txt").write_text("not in clean manifest")
            with self.assertRaises(ValueError):
                verify_snapshot(root, metadata, manifest)
            (root / "predioon-clean.ini").write_text("path=/outside/another.avd\ntarget=android-35\n")
            with self.assertRaisesRegex(ValueError, "path"):
                seal_snapshot(root, metadata, health)

    def test_restore_requires_same_guest_boot_and_new_host_adb_identity(self):
        original = {"bootId": BOOT, "adbPublicKeySha256": "a" * 64}
        restored = {"bootId": BOOT, "adbPublicKeySha256": "b" * 64}
        require_restored_boot(restored, original)
        for change in [{"bootId": "22222222-2222-4222-8222-222222222222"}, {"adbPublicKeySha256": "a" * 64}, {"adbPublicKeySha256": "bad"}, {"bootId": ""}]:
            with self.assertRaises(ValueError):
                require_restored_boot({**restored, **change}, original)

    def test_manifest_from_other_sdk_runner_or_settings_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            metadata, _, health = self.fixture(root)
            manifest = seal_snapshot(root, metadata, health)
            changed = build_metadata(EMULATOR, IMAGE, {**HOST, "cpu": "another CPU"}, SETTINGS)
            with self.assertRaises(ValueError):
                verify_snapshot(root, changed, manifest)
            malformed = copy.deepcopy(manifest)
            malformed["health"]["checks"]["diagnosticsClean"] = False
            with self.assertRaises(ValueError):
                verify_snapshot(root, metadata, malformed)


if __name__ == "__main__":
    unittest.main()
