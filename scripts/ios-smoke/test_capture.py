import os
from pathlib import Path
import unittest
from unittest.mock import patch

from capture import capture, iphone_target, simulator_entitlements


class RuntimeSelection(unittest.TestCase):
    def inventory(self):
        return {
            "runtimes": [
                {"identifier": "com.apple.CoreSimulator.SimRuntime.iOS-26-2", "version": "26.2", "isAvailable": True},
                {"identifier": "com.apple.CoreSimulator.SimRuntime.iOS-18-5", "version": "18.5.0", "isAvailable": True},
            ],
            "devicetypes": [{"name": "iPhone 16", "identifier": "iphone16"}],
            "devices": {
                "com.apple.CoreSimulator.SimRuntime.iOS-26-2": [{"name": "iPhone 17 Pro", "deviceTypeIdentifier": "iphone17pro", "isAvailable": True}],
                "com.apple.CoreSimulator.SimRuntime.iOS-18-5": [{"name": "iPhone 16", "isAvailable": True}],
            },
        }

    def test_older_xcode_uses_its_compatible_runtime_even_when_newer_images_are_installed(self):
        self.assertEqual(iphone_target(self.inventory(), "18.5"), ("com.apple.CoreSimulator.SimRuntime.iOS-18-5", "iphone16"))

    def test_new_xcode_can_select_newer_available_runtime(self):
        self.assertEqual(iphone_target(self.inventory(), "26.2"), ("com.apple.CoreSimulator.SimRuntime.iOS-26-2", "iphone17pro"))

    def test_missing_compatible_device_fails_instead_of_using_the_newer_image(self):
        inventory = self.inventory()
        inventory["devices"]["com.apple.CoreSimulator.SimRuntime.iOS-18-5"][0]["isAvailable"] = False
        with self.assertRaisesRegex(RuntimeError, "compatible"):
            iphone_target(inventory, "18.5")

    def test_refuses_non_ci_computers_before_accessing_files_or_simulators(self):
        with patch.dict(os.environ, {"GITHUB_ACTIONS": "false"}):
            with self.assertRaisesRegex(RuntimeError, "disposable GitHub"):
                capture(Path("does-not-exist.app"), Path("must-not-be-created"))

    def test_each_simulator_product_receives_only_its_own_keychain_group(self):
        groups = []
        for bundle in ["com.predioon.resident", "com.predioon.operations"]:
            entitlements = simulator_entitlements({"CFBundleIdentifier": bundle, "CFBundleSupportedPlatforms": ["iPhoneSimulator"]})
            self.assertEqual(set(entitlements), {"application-identifier", "keychain-access-groups"})
            self.assertEqual(entitlements["keychain-access-groups"], [entitlements["application-identifier"]])
            self.assertTrue(entitlements["application-identifier"].endswith("." + bundle))
            groups.extend(entitlements["keychain-access-groups"])
        self.assertEqual(len(set(groups)), 2)

    def test_device_distribution_and_foreign_bundles_are_not_signed(self):
        for info in [
            {"CFBundleIdentifier": "com.predioon.resident", "CFBundleSupportedPlatforms": ["iPhoneOS"]},
            {"CFBundleIdentifier": "com.example.foreign", "CFBundleSupportedPlatforms": ["iPhoneSimulator"]},
        ]:
            with self.assertRaises(RuntimeError):
                simulator_entitlements(info)


if __name__ == "__main__":
    unittest.main()
