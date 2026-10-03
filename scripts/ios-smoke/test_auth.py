"""Host-side tests; they never create a database or an Apple simulator."""
import importlib.util
import json
from pathlib import Path
import random
import struct
import tempfile
import unittest
from unittest.mock import patch
import zlib

BASE = Path(__file__).resolve().parent


def png_fixture():
    def chunk(kind, contents):
        return struct.pack(">I", len(contents)) + kind + contents + struct.pack(">I", zlib.crc32(kind + contents))
    random_bytes = random.Random(2)
    pixels = b"".join(b"\x00" + random_bytes.randbytes(32 * 3) for _ in range(32))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 32, 32, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b"")


def load(name):
    spec = importlib.util.spec_from_file_location("ios_" + name, BASE / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ConfigurationTests(unittest.TestCase):
    def test_closed_origin_and_exact_source(self):
        prepare = load("prepare_auth")
        source = 'const PRODUCTION_API_URL = "";\n'
        self.assertEqual(prepare.configure_source(source), 'const PRODUCTION_API_URL = "https://127.0.0.1:3443";\n')
        for invalid in [source + source, "const PRODUCTION_API_URL = endpoint;"]:
            with self.assertRaises(ValueError):
                prepare.configure_source(invalid)

    def test_temp_and_ci_guards_precede_changes(self):
        prepare = load("prepare_auth")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            good = {"GITHUB_ACTIONS": "true", "RUNNER_OS": "macOS", "RUNNER_TEMP": temporary}
            self.assertEqual(prepare.disposable_path(root / "auth", good), (root / "auth").resolve())
            for env in [{**good, "GITHUB_ACTIONS": "false"}, {**good, "RUNNER_OS": "Windows"}]:
                with self.assertRaises(ValueError):
                    prepare.disposable_path(root / "auth", env)
            for path in [root, root.parent / "personal", root / ".." / "personal"]:
                with self.assertRaises(ValueError):
                    prepare.disposable_path(path, good)


class ExportTests(unittest.TestCase):
    def test_png_magic_is_not_sufficient_for_a_real_native_image(self):
        run = load("run_auth")
        valid = png_fixture()
        for invalid in [b"\x89PNG\r\n\x1a\n" + b"x" * 1024, valid[:-1], valid + b"secret tail",
                        valid[:24] + bytes([valid[24] ^ 1]) + valid[25:]]:
            with self.subTest(size=len(invalid)), self.assertRaises(run.SecurityViolation):
                run.validate_png(invalid)
        self.assertEqual(run.validate_png(valid), (32, 32))

    def test_export_rejects_credentials_even_when_truncated(self):
        run = load("run_auth")
        secrets = [" OldPassword123456789 ", " NewPassword987654321 "]
        for value in [secrets[0], secrets[1], "OldPassword123", "NewPassword987", "eyJabcdefghijklmnop.qwertyuiopasdf.zxcvbnmasdfgh", "a" * 64]:
            with self.subTest(value=value), self.assertRaises(run.SecurityViolation):
                run.reject_secrets(value, secrets)

    def test_allowlist_rejects_unknown_keys_and_filenames(self):
        run = load("run_auth")
        with self.assertRaises(run.SecurityViolation):
            run.safe_snapshot({"resident-mobile": {"password": "hidden"}})
        for filename in ["xcresult", "fixture.json", "phase.xml", "01-login.png/../secret", "token.log"]:
            with self.assertRaises(run.SecurityViolation):
                run.evidence_filename(filename)

    def test_exact_snapshot_counts_and_no_new_family_on_restore(self):
        run = load("run_auth")
        expected = run.counts("restored")
        self.assertEqual(expected, {"sessions": 1, "active_sessions": 1, "logouts": 0,
                                   "refresh_tokens": 2, "rotations": 1, "live_refresh_tokens": 1})
        self.assertEqual(run.counts("changed")["active_sessions"], 0)
        self.assertEqual(run.counts("logout")["sessions"], 2)

    def test_privacy_failure_is_first_and_blocks_both_collectors(self):
        run = load("run_auth")
        gate = run.EvidenceGate()
        gate.reject("private-identity")
        gate.reject("credential-exposure")
        self.assertEqual(gate.failure["kind"], "private-identity")
        for app in run.APPS:
            with self.assertRaises(run.SecurityViolation):
                gate.require_open()
        self.assertEqual(set(gate.failure), {"kind", "observedAt"})

    def test_phase_payload_is_closed_and_contains_only_booleans(self):
        run = load("run_auth")
        valid = {"app": "resident-mobile", "phase": "01-login", "checks": {"privacy": True, "screen": True, "secure": True}}
        self.assertEqual(run.safe_checkpoint(valid), valid)
        for invalid in [{**valid, "tree": "secret"}, {**valid, "phase": "unknown"},
                        {**valid, "checks": {"privacy": True, "screen": "password", "secure": True}}]:
            with self.assertRaises(run.SecurityViolation):
                run.safe_checkpoint(invalid)

    def test_invalid_artifact_never_creates_public_staging(self):
        run = load("run_auth")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            private, public = root / "private", root / "public"
            private.mkdir()
            (private / "fixture.json").write_text('{"password":"Secret123456789"}')
            with self.assertRaises(run.SecurityViolation):
                run.export_evidence(private, public, ["Secret123456789"])
            self.assertFalse(public.exists())

    def test_known_filename_cannot_smuggle_an_extra_json_field(self):
        run = load("run_auth")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            private, public = root / "private", root / "public"
            private.mkdir()
            (private / "builds.json").write_text('[{"token":"eyJabcdefghijklmnop.qwertyuiopasdf.zxcvbnmasdfgh"}]')
            with self.assertRaises(run.SecurityViolation):
                run.export_evidence(private, public, [])
            self.assertFalse(public.exists())

    def test_known_token_cannot_hide_in_a_valid_sha_field(self):
        run = load("run_auth")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            private, public = root / "private", root / "public"
            private.mkdir()
            token = "a" * 64
            builds = [{"app": app, "bundleId": bundle, "mode": "Release", "sha256": token} for app, bundle in run.APPS.items()]
            (private / "builds.json").write_text(json.dumps(builds))
            result = {"passed": False, "scope": run.SCOPE, "commit": "b" * 40,
                      "runtime": "com.apple.CoreSimulator.SimRuntime.iOS-18-5", "sdkVersion": "18.5", "steps": []}
            (private / "result.json").write_text(json.dumps(result))
            with self.assertRaises(run.SecurityViolation):
                run.export_evidence(private, public, [token])
            self.assertFalse(public.exists())

    def test_safe_partial_failure_exports_only_the_closed_schema(self):
        run = load("run_auth")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            private, public = root / "private", root / "public"
            private.mkdir()
            builds = [{"app": app, "bundleId": bundle, "mode": "Release", "sha256": "a" * 64} for app, bundle in run.APPS.items()]
            (private / "builds.json").write_text(json.dumps(builds))
            result = {"passed": False, "scope": run.SCOPE, "commit": "b" * 40,
                      "runtime": "com.apple.CoreSimulator.SimRuntime.iOS-18-5", "sdkVersion": "18.5", "steps": [],
                      "failureKind": "native-journey-failed"}
            (private / "result.json").write_text(json.dumps(result))
            run.export_evidence(private, public, ["NewSecret123456789"])
            self.assertEqual({path.name for path in public.iterdir()}, {"builds.json", "result.json"})

    def test_simulator_selector_never_uses_booted_or_personal_uuid(self):
        run = load("run_auth")
        for invalid in ["booted", "all", "personal-phone", "00000000-0000-0000-0000-000000000000"]:
            with self.assertRaises(ValueError):
                run.owned_simulator(invalid, None)
        value = "f19ce90e-9c36-461d-a499-692ff2570a01"
        self.assertEqual(run.owned_simulator(value, value), value)


class SourceContractTests(unittest.TestCase):
    def test_database_is_pinned_and_scoped(self):
        source = (BASE / "database.sh").read_text()
        for literal in ["971766d645aa73e93b9ef4e3be44201b4f45b5477095b049125403f9f3386d6f", "85dd01deaa0728f95d117c1a75ca0cbf78f3301e6ab2b98bebe5f7c95b793acb", "contrib/btree_gist", "127.0.0.1", "RUNNER_TEMP"]:
            self.assertIn(literal, source)
        self.assertNotIn("sudo", source)

    def test_standalone_runner_and_no_raw_artifact_upload(self):
        ruby = (BASE / "project.rb").read_text()
        self.assertIn(":ui_test_bundle", ruby)
        self.assertIn("USES_XCTRUNNER", ruby)
        self.assertNotIn("TEST_TARGET_NAME", ruby)
        self.assertNotIn("TEST_HOST", ruby)
        workflow = (BASE.parents[1] / ".github/workflows/ios-auth.yml").read_text()
        self.assertIn("runs-on: macos-15", workflow)
        self.assertIn("path: .local/ios-auth/evidence/", workflow)
        self.assertNotIn("path: ${{ runner.temp }}", workflow)
        swift = (BASE / "AuthJourney.swift").read_text()
        self.assertIn("XCUIApplication(bundleIdentifier:", swift)
        self.assertNotIn("XCTAttachment", swift)


class CoordinatorTests(unittest.TestCase):
    def setUp(self):
        self.run = load("run_auth")
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.coordinator = self.run.Coordinator(self.root, self.root, self.root / "fixture.json",
            "f19ce90e-9c36-461d-a499-692ff2570a01", "private-coordinator-token", ["SecretPassword123456"])

    def tearDown(self):
        self.temporary.cleanup()

    def test_first_security_negative_blocks_all_future_reads_and_captures(self):
        with self.assertRaises(self.run.SecurityViolation):
            self.coordinator.request("/rejection", {"kind": "private-identity"})
        with patch.object(self.run, "database_snapshot") as database, patch.object(self.run, "command") as capture:
            for app in self.run.APPS:
                with self.assertRaises(self.run.SecurityViolation):
                    self.coordinator.request("/checkpoint", {"app": app, "phase": "00-empty", "checks": {"privacy": True, "screen": True, "secure": True}})
            database.assert_not_called()
            capture.assert_not_called()
        self.assertEqual(list(self.root.iterdir()), [])

    def test_database_mismatch_or_bad_sequence_never_capture(self):
        self.coordinator.started = True
        valid = {"app": "resident-mobile", "phase": "00-empty", "checks": {"privacy": True, "screen": True, "secure": True}}
        with patch.object(self.run, "database_snapshot", return_value={app: self.run.counts("login") for app in self.run.APPS}), patch.object(self.run, "command") as capture:
            with self.assertRaises(AssertionError):
                self.coordinator.request("/checkpoint", valid)
            with self.assertRaises(AssertionError):
                self.coordinator.request("/checkpoint", {**valid, "phase": "01-login"})
            capture.assert_not_called()
        self.assertEqual(list(self.root.iterdir()), [])

    def test_png_is_captured_only_after_native_and_database_approval(self):
        self.coordinator.started = True
        snapshot = {app: self.run.counts("empty") for app in self.run.APPS}
        order = []
        def db(_fixture):
            order.append("database"); return snapshot
        valid = {"app": "resident-mobile", "phase": "00-empty", "checks": {"privacy": True, "screen": True, "secure": True}}
        with patch.object(self.run, "database_snapshot", side_effect=db), patch.object(self.run, "command") as capture:
            response = self.coordinator.request("/checkpoint", valid)
            capture.assert_not_called()
            self.assertEqual(list(self.root.iterdir()), [])
            self.assertEqual(self.coordinator.steps, [])
            import base64
            self.coordinator.request("/capture", {**valid, "nonce": response["nonce"],
                "png": base64.b64encode(png_fixture()).decode()})
            capture.assert_not_called()
        self.assertEqual(order, ["database"])
        self.assertEqual(len(self.coordinator.steps), 1)
        exported = json.loads((self.root / "resident-mobile-00-empty.json").read_text())
        self.assertEqual(set(exported), {"app", "phase", "checks", "snapshot", "apiEvents", "screenshotSha256"})
        self.assertNotIn("tree", exported)

    def test_nonce_expired_wrong_or_replayed_never_exports_an_image(self):
        import base64
        valid = {"app": "resident-mobile", "phase": "00-empty", "checks": {"privacy": True, "screen": True, "secure": True}}
        self.coordinator.started = True
        with patch.object(self.run, "database_snapshot", return_value={app: self.run.counts("empty") for app in self.run.APPS}):
            response = self.coordinator.request("/checkpoint", valid)
        image = base64.b64encode(png_fixture()).decode()
        for change in [{"nonce": "wrong"}, {"app": "operations-mobile"}, {"checks": {"privacy": False, "screen": True, "secure": True}}]:
            with self.assertRaises(self.run.SecurityViolation):
                self.coordinator.request("/capture", {**valid, "nonce": response["nonce"], "png": image, **change})
            self.assertEqual(list(self.root.iterdir()), [])
        self.coordinator.pending["expires"] = 0
        with self.assertRaises(self.run.SecurityViolation):
            self.coordinator.request("/capture", {**valid, "nonce": response["nonce"], "png": image})
        self.assertEqual(list(self.root.iterdir()), [])

    def test_real_response_can_finish_after_ui_but_retries_or_wrong_status_fail(self):
        response = {"method": "POST", "path": "/auth/logout", "status": 204}
        with patch.object(self.run, "proxy_events", side_effect=[[], [response]]), patch.object(self.run.time, "sleep") as wait:
            self.assertEqual(self.run.wait_proxy_events(self.root / "proxy.log", 0, ("/auth/logout", 204)), [response])
            wait.assert_called_once_with(0.25)
        for events in [[response, response], [{**response, "status": 500}]]:
            with patch.object(self.run, "proxy_events", return_value=events), self.assertRaises(AssertionError):
                self.run.wait_proxy_events(self.root / "proxy.log", 0, ("/auth/logout", 204))

    def test_missing_real_response_has_a_bounded_deadline(self):
        with patch.object(self.run, "proxy_events", return_value=[]), patch.object(self.run.time, "monotonic", side_effect=[0, 16]), patch.object(self.run.time, "sleep") as wait:
            with self.assertRaises(AssertionError):
                self.run.wait_proxy_events(self.root / "proxy.log", 0, ("/auth/logout", 204))
            wait.assert_not_called()

    def test_late_duplicate_logout_is_rejected_on_cold_phase_before_capture(self):
        product = "operations-mobile"
        phase = "12-cold-logout-empty"
        self.coordinator.started = True
        self.coordinator.states = {app: "logout" for app in self.run.APPS}
        self.coordinator.steps = [{"app": app, "phase": name, "passed": True}
                                  for app, name in self.coordinator.order[:-1]]
        event = {"method": "POST", "path": "/auth/logout", "status": 204}
        snapshot = {app: self.run.counts("logout") for app in self.run.APPS}
        payload = {"app": product, "phase": phase, "checks": {"privacy": True, "screen": True, "secure": True}}
        with patch.object(self.run, "proxy_events", return_value=[event]), patch.object(self.run, "database_snapshot", return_value=snapshot):
            with self.assertRaises(AssertionError):
                self.coordinator.request("/checkpoint", payload)
        self.assertIsNone(self.coordinator.pending)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_required_phase_rejects_an_extra_post_to_another_auth_route(self):
        self.coordinator.started = True
        self.coordinator.steps = [{"app": "resident-mobile", "phase": "00-empty", "passed": True}]
        events = [{"method": "POST", "path": "/auth/login", "status": 200},
                  {"method": "POST", "path": "/auth/logout", "status": 204}]
        snapshot = {app: self.run.counts("login" if app == "resident-mobile" else "empty") for app in self.run.APPS}
        payload = {"app": "resident-mobile", "phase": "01-login", "checks": {"privacy": True, "screen": True, "secure": True}}
        with patch.object(self.run, "proxy_events", return_value=events), patch.object(self.run, "database_snapshot", return_value=snapshot):
            with self.assertRaises(AssertionError):
                self.coordinator.request("/checkpoint", payload)
        self.assertIsNone(self.coordinator.pending)

    def test_post_arriving_during_database_snapshot_is_rejected_before_nonce(self):
        self.coordinator.started = True
        snapshot = {app: self.run.counts("empty") for app in self.run.APPS}
        event = {"method": "POST", "path": "/auth/logout", "status": 204}
        payload = {"app": "resident-mobile", "phase": "00-empty", "checks": {"privacy": True, "screen": True, "secure": True}}
        with patch.object(self.run, "proxy_events", side_effect=[[], [event]]), patch.object(self.run, "database_snapshot", return_value=snapshot):
            with self.assertRaises(AssertionError):
                self.coordinator.request("/checkpoint", payload)
        self.assertIsNone(self.coordinator.pending)

    def test_finish_rejects_late_extra_post_without_replaying_any_action(self):
        self.coordinator.started = True
        self.coordinator.steps = [{"app": app, "phase": phase, "passed": True} for app, phase in self.coordinator.order]
        expected = [{"method": "POST", "path": path, "status": status} for path, status in [
            ("/auth/login", 200), ("/auth/login", 200),
            ("/auth/password", 400), ("/auth/refresh", 200), ("/auth/password", 204),
            ("/auth/login", 401), ("/auth/login", 200), ("/auth/logout", 204),
            ("/auth/password", 400), ("/auth/refresh", 200), ("/auth/password", 204),
            ("/auth/login", 401), ("/auth/login", 200), ("/auth/logout", 204),
        ]]
        self.assertEqual(len(expected), 14)
        with patch.object(self.run, "proxy_events", return_value=expected + [expected[-1]]), patch.object(self.run, "command") as command:
            with self.assertRaises(AssertionError):
                self.coordinator.request("/finish", {})
            command.assert_not_called()
        self.assertFalse(self.coordinator.finished)
        with patch.object(self.run, "proxy_events", return_value=expected), patch.object(self.run, "command") as command:
            self.coordinator.request("/finish", {})
            command.assert_not_called()
        self.assertTrue(self.coordinator.finished)

    def test_changed_tree_after_db_approval_blocks_the_pending_capture(self):
        valid = {"app": "resident-mobile", "phase": "00-empty", "checks": {"privacy": True, "screen": True, "secure": True}}
        self.coordinator.started = True
        with patch.object(self.run, "database_snapshot", return_value={app: self.run.counts("empty") for app in self.run.APPS}):
            self.coordinator.request("/checkpoint", valid)
        with self.assertRaises(self.run.SecurityViolation):
            self.coordinator.request("/rejection", {"kind": "private-identity"})
        with self.assertRaises(self.run.SecurityViolation):
            self.coordinator.request("/capture", {**valid, "nonce": "anything", "png": "anything"})
        self.assertEqual(list(self.root.iterdir()), [])

    def test_proxy_diagnostics_have_an_exact_route_and_scalar_schema(self):
        log = self.root / "proxy.log"
        for item in [{"method": "POST", "path": "/access/gate/open", "status": 200},
                     {"method": "POST", "path": "/auth/login", "status": 200, "body": "password"},
                     {"method": "POST", "path": "/auth/login", "status": True}]:
            log.write_text(json.dumps(item))
            with self.assertRaises(self.run.SecurityViolation):
                self.run.proxy_events(log)

    def test_driver_errors_never_export_stdout_stderr_or_arguments(self):
        secret = "NoSecretMayReachAnException123"
        response = type("Response", (), {"returncode": 1, "stdout": secret, "stderr": secret})()
        with patch.object(self.run.subprocess, "run", return_value=response):
            with self.assertRaises(RuntimeError) as failure:
                self.run.command("xcodebuild", secret)
        self.assertNotIn(secret, str(failure.exception))

    def test_non_ci_guard_precedes_products_and_commands(self):
        with patch.dict(self.run.os.environ, {"GITHUB_ACTIONS": "false"}), patch.object(self.run, "command") as command:
            with self.assertRaises(ValueError):
                self.run.run(self.root, self.root / "evidence", self.root / "personal.app", self.root / "peer.app")
            command.assert_not_called()


if __name__ == "__main__":
    unittest.main()
