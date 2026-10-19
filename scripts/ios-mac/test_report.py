import json
from pathlib import Path
import plistlib
import tempfile
import unittest

from report import bundle, device_from_devicectl, export_options, main, render, team_from_defaults, write_report


def run_directory(root: Path, steps: str) -> Path:
    (root / "logs").mkdir(parents=True)
    (root / "steps.tsv").write_text(steps, encoding="utf-8")
    (root / "env.tsv").write_text("commit\tabc123def4567890\nbranch\tmain\nXcode\tXcode 16.4\n", encoding="utf-8")
    return root


class Report(unittest.TestCase):
    def test_all_ok_steps_pass_and_skipped_steps_do_not_count_as_failures(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = run_directory(Path(temporary), "prerequisites\tok\t12\tlogs/prerequisites.log\tPré-requisitos\n"
                                                     "device\tskip\t0\t\tiPhone — sem --device\n")
            self.assertTrue(write_report(directory))
            markdown = (directory / "report.md").read_text(encoding="utf-8")
            self.assertIn("APROVADA", markdown)
            self.assertIn("| Xcode | Xcode 16.4 |", markdown)
            self.assertIn("`abc123def456`", markdown)
            data = json.loads((directory / "report.json").read_text(encoding="utf-8"))
            self.assertTrue(data["passed"])
            self.assertEqual([step["status"] for step in data["steps"]], ["ok", "skip"])

    def test_one_failure_or_no_executed_step_fails_the_report(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = run_directory(Path(temporary), "a\tok\t1\tlogs/a.log\tA\nb\tfail\t65\tlogs/b.log\tB\n")
            markdown, data = render(directory)
            self.assertFalse(data["passed"])
            self.assertIn("REPROVADA", markdown)
            self.assertIn("1 min 5 s", markdown)
        with tempfile.TemporaryDirectory() as temporary:
            self.assertFalse(render(run_directory(Path(temporary), "a\tskip\t0\t\tA\n"))[1]["passed"])
        with tempfile.TemporaryDirectory() as temporary:
            self.assertEqual(main(["render", "--dir", str(run_directory(Path(temporary), "a\tfail\t1\t\tA\n"))]), 1)

    def test_simulator_evidence_is_listed_with_its_screenshots(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = run_directory(Path(temporary), "a\tok\t1\t\tA\n")
            capture = directory / "captures" / "resident-mobile"
            capture.mkdir(parents=True)
            (capture / "result.json").write_text(json.dumps({
                "passed": True, "runtime": "iOS-18-5", "deviceType": "iPhone16", "phases": ["release-installed"],
                "launchSeconds": {"01-first-launch": 9.2}, "screenshots": [{"file": "01-first-launch.png"}],
            }), encoding="utf-8")
            markdown, _ = render(directory)
            self.assertIn("### resident-mobile: aprovado", markdown)
            self.assertIn("](captures/resident-mobile/01-first-launch.png)", markdown)

    def test_bundle_shares_report_evidence_and_failed_tails_but_never_full_logs(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = run_directory(Path(temporary) / "run", "a\tok\t1\tlogs/a.log\tA\nb\tfail\t1\tlogs/b.log\tB\n")
            (directory / "logs" / "a.log").write_text("ok\n", encoding="utf-8")
            (directory / "logs" / "b.log").write_text("".join(f"line {number}\n" for number in range(500)), encoding="utf-8")
            capture = directory / "captures" / "operations-mobile"
            capture.mkdir(parents=True)
            for name in ("result.json", "01-first-launch.png", "01-first-launch.ocr.json", "application.log"):
                (capture / name).write_text("{}", encoding="utf-8")
            write_report(directory)
            destination = Path(temporary) / "published"
            bundle(directory, destination)
            shared = sorted(str(path.relative_to(destination)).replace("\\", "/") for path in destination.rglob("*") if path.is_file())
            self.assertEqual(shared, ["captures/operations-mobile/01-first-launch.ocr.json", "captures/operations-mobile/01-first-launch.png",
                                      "captures/operations-mobile/result.json", "logs/b.tail.log", "report.json", "report.md"])
            tail = (destination / "logs" / "b.tail.log").read_text(encoding="utf-8").splitlines()
            self.assertEqual((len(tail), tail[0], tail[-1]), (200, "line 300", "line 499"))


class Team(unittest.TestCase):
    def preferences(self, *teams, key="IDEProvisioningTeamByIdentifier"):
        return plistlib.dumps({key: {"account-1": list(teams)}})

    def test_single_free_team_is_selected_from_current_and_older_xcode_layouts(self):
        free = {"teamID": "FREE123456", "teamName": "Amigo (Personal Team)", "isFreeProvisioningTeam": True}
        self.assertEqual(team_from_defaults(self.preferences(free)), "FREE123456")
        self.assertEqual(team_from_defaults(self.preferences(free, key="IDEProvisioningTeams"), "free"), "FREE123456")

    def test_kind_filters_and_ambiguity_requires_an_explicit_team(self):
        free = {"teamID": "FREE123456", "teamName": "Pessoal", "isFreeProvisioningTeam": True}
        paid = {"teamID": "PAID123456", "teamName": "Prédio ON", "isFreeProvisioningTeam": False}
        content = self.preferences(free, paid)
        self.assertEqual(team_from_defaults(content, "paid"), "PAID123456")
        self.assertEqual(team_from_defaults(content, "free"), "FREE123456")
        with self.assertRaisesRegex(ValueError, "--team"):
            team_from_defaults(content)
        with self.assertRaisesRegex(ValueError, "Encontrei 0"):
            team_from_defaults(plistlib.dumps({}))


class Device(unittest.TestCase):
    def device(self, udid, pairing="paired", transport="wired", platform="iOS"):
        return {"identifier": f"core-{udid}", "deviceProperties": {"name": f"iPhone {udid}"},
                "hardwareProperties": {"platform": platform, "udid": udid},
                "connectionProperties": {"pairingState": pairing, **({"transportType": transport} if transport else {})}}

    def test_only_the_single_paired_connected_iphone_is_selected(self):
        listing = {"result": {"devices": [self.device("A"), self.device("B", transport=None),
                                          self.device("C", pairing="unpaired"), self.device("D", platform="watchOS")]}}
        self.assertEqual(device_from_devicectl(listing), ("core-A", "A", "iPhone A"))

    def test_none_or_several_connected_iphones_are_refused(self):
        with self.assertRaisesRegex(ValueError, "Encontrei 0"):
            device_from_devicectl({"result": {"devices": []}})
        with self.assertRaisesRegex(ValueError, "Encontrei 2"):
            device_from_devicectl({"result": {"devices": [self.device("A"), self.device("B", transport="localNetwork")]}})


class ExportOptions(unittest.TestCase):
    def test_uploads_to_app_store_connect_with_automatic_signing_for_the_team(self):
        options = plistlib.loads(export_options("PAID123456"))
        self.assertEqual((options["method"], options["destination"], options["teamID"], options["signingStyle"]),
                         ("app-store-connect", "upload", "PAID123456", "automatic"))
        self.assertFalse(options["manageAppVersionAndBuildNumber"])


if __name__ == "__main__":
    unittest.main()
