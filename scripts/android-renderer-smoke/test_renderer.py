import io
import json
import hashlib
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import shutil
import ssl
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from monitor import RendererFailure, RendererMonitor, classify, marker_time, public_report
from policy import allows


SECRET = "PRIVATE_PASSWORD_TOKEN_AND_TREE"
PID = 3540
SOURCE = {"commit": "a" * 40, "apkSha256": "b" * 64, "reactNative": "0.87.1", "androidApi": 35, "abi": "x86_64"}


def line(message, pid=PID, tag="unknown:SurfaceMountingManager", instant="1791065526.176"):
    return f"{instant} {pid:5} {pid:5} E {tag}: {message}\n"


class RendererTests(unittest.TestCase):
    def test_missing_view_state_is_terminal_at_header(self):
        self.assertEqual(classify(line("Unhandled SoftException", tag="unknown:SurfaceMountingManager:MissingViewState"), PID),
                         {"category": "renderer-missing-view-state", "deviceTime": "1791065526.176"})

    def test_remove_view_at_mismatch_is_terminal(self):
        self.assertEqual(classify(line("com.facebook.react.bridge.ReactNoCrashSoftException: Tried to remove view [302] of parent [330] at index 12, but got view tag 306 - actual index of view: 11"), PID)["category"],
                         "renderer-remove-view-at")

    def test_already_removed_child_is_not_ignored(self):
        self.assertEqual(classify(line("removeViewAt: [338] -> [330] @4: view already removed from parent! Children in parent: 5"), PID)["category"],
                         "renderer-remove-view-at")

    def test_unclassified_native_soft_exception_also_fails(self):
        self.assertEqual(classify(line("com.facebook.react.bridge.ReactNoCrashSoftException: " + SECRET), PID)["category"],
                         "renderer-soft-exception")

    def test_neighbor_pid_and_other_tags_are_not_our_renderer(self):
        self.assertIsNone(classify(line("MissingViewState", pid=9999), PID))
        self.assertIsNone(classify(line("MissingViewState", tag="PrivateLogger"), PID))
        self.assertIsNone(classify(line("ordinary message " + SECRET), PID))

    def test_banner_and_stack_frame_alone_are_clean(self):
        self.assertIsNone(classify("--------- beginning of main\n", PID))
        self.assertIsNone(classify(line("\tat SurfaceMountingManager.removeViewAt(SurfaceMountingManager.kt:485)"), PID))

    def test_epoch_display_padding_does_not_reject_native_tags(self):
        # liblog renders tags with %-8.*s, so short tags have spaces before ':'.
        for tag in ["libc    ", "resolv  ", "art     "]:
            with self.subTest(tag=tag):
                self.assertIsNone(classify(line("ordinary native diagnostic", tag=tag), PID))
        self.assertEqual(classify(line("Unhandled SoftException", tag="unknown:SurfaceMountingManager:MissingViewState  "), PID),
                         {"category": "renderer-missing-view-state", "deviceTime": "1791065526.176"})

    def test_invalid_format_is_not_a_clean_diagnostic(self):
        for source in [SECRET, "NaN 3540 3540 E unknown:SurfaceMountingManager: MissingViewState", "1791065526.176 3540 E malformed",
                       "1791065526.176 3540 3540 E         : no tag"]:
            with self.assertRaisesRegex(RendererFailure, "log-format-rejected"):
                classify(source, PID)

    def test_first_failure_survives_later_clean_or_other_failure(self):
        monitor = RendererMonitor(PID)
        monitor.observe(line("Unhandled SoftException", tag="unknown:SurfaceMountingManager:MissingViewState"))
        first = dict(monitor.failure)
        monitor.observe(line("ReactNoCrashSoftException: Tried to remove view [1] at index 1, but got view tag 2"))
        monitor.observe(line("ordinary clean result"))
        self.assertEqual(monitor.failure, first)
        with self.assertRaisesRegex(RendererFailure, "renderer-missing-view-state"):
            monitor.check()

    def test_logcat_is_explicitly_filtered_to_bound_pid(self):
        monitor = RendererMonitor(PID)
        commands = []
        def adb(*args, **kwargs):
            commands.append(args)
            return str(PID) if args[:2] == ("shell", "pidof") else line("clean")
        monitor.snapshot(adb)
        self.assertIn(("logcat", "--pid=3540", "-b", "main", "-d", "-v", "epoch", "*:V"), commands)

    def test_changed_or_missing_process_fails_before_dump(self):
        for response in ["", "9999", "3540 9999"]:
            monitor = RendererMonitor(PID)
            calls = []
            def adb(*args, **kwargs):
                calls.append(args)
                return response
            with self.assertRaisesRegex(RendererFailure, "process-changed"):
                monitor.snapshot(adb)
            self.assertEqual(len(calls), 1)

    def test_snapshot_failure_is_terminal_and_private(self):
        monitor = RendererMonitor(PID)
        def adb(*args, **kwargs):
            if args[0] == "logcat":
                raise RuntimeError(SECRET)
            return str(PID)
        with self.assertRaisesRegex(RendererFailure, "diagnostic-stream-failed") as error:
            monitor.snapshot(adb)
        self.assertNotIn(SECRET, str(error.exception))

    def test_failure_blocks_the_next_user_action(self):
        from run_renderer import RendererDevice
        with tempfile.TemporaryDirectory() as temporary:
            fixture = {"accounts": {"resident-mobile": {}}, "forbidden": []}
            device = RendererDevice("emulator-5554", Path(temporary), fixture, "A" * 32)
            device.monitor = RendererMonitor(PID)
            device.monitor.observe(line("MissingViewState", tag="unknown:SurfaceMountingManager:MissingViewState"))
            with patch.object(device, "raw") as raw:
                with self.assertRaises(RendererFailure):
                    device.adb("shell", "input", "tap", "1", "2")
                raw.assert_not_called()

    def test_screen_collection_is_disabled(self):
        from run_renderer import RendererDevice
        with tempfile.TemporaryDirectory() as temporary:
            device = RendererDevice("emulator-5554", Path(temporary), {"accounts": {"resident-mobile": {}}, "forbidden": []}, "A" * 32)
            with patch.object(device, "adb") as adb:
                device.screen("first-negative")
                adb.assert_not_called()
            self.assertEqual(list(Path(temporary).iterdir()), [])

    def test_exact_closed_marker_must_be_present_once(self):
        value = "seq=1,phase=finance,boundary=before,kind=tap"
        source = line(value, pid=1234, tag="PredioonRenderer")
        self.assertEqual(marker_time(source, value), "1791065526.176")
        for body in ["", source + source, line(SECRET, tag="PredioonRenderer")]:
            with self.assertRaises(RendererFailure):
                marker_time(body, value)

    def test_public_export_contains_only_closed_metadata(self):
        report = public_report(False, "renderer-missing-view-state", PID,
            [{"sequence": 1, "phase": "finance", "boundary": "before", "kind": "tap", "deviceTime": "1791065526.176"}],
            {"category": "renderer-missing-view-state", "deviceTime": "1791065526.176"}, False)
        self.assertEqual(set(report), {"schema", "app", "passed", "category", "pid", "markers", "firstFailure", "domainSnapshotUnchanged", "source"})
        self.assertNotIn(SECRET, json.dumps(report))

    def test_public_export_rejects_unknown_keys_and_disguised_private_values(self):
        valid = {"sequence": 1, "phase": "finance", "boundary": "before", "kind": "tap", "deviceTime": "1791065526.176"}
        for changes in [{"stderr": SECRET}, {"phase": SECRET}, {"deviceTime": SECRET}, {"sequence": True}, {"kind": SECRET}]:
            with self.assertRaises(RendererFailure):
                public_report(False, "ui-incomplete", PID, [dict(valid, **changes)], None, False)
        for category in [SECRET, "proxy_ready"]:
            with self.assertRaises(RendererFailure):
                public_report(False, category, PID, [], None, False)

    def test_unordered_marker_sequence_is_rejected(self):
        markers = [{"sequence": number, "phase": "finance", "boundary": "before", "kind": "tap", "deviceTime": "1791065526.176"} for number in [2, 1]]
        with self.assertRaises(RendererFailure):
            public_report(False, "ui-incomplete", PID, markers, None, False)

    def test_incomplete_journey_cannot_be_exported_as_passed(self):
        with self.assertRaises(RendererFailure):
            public_report(True, "passed", PID, [], None, True)

    def test_late_failure_during_monitor_cleanup_stays_terminal(self):
        from run_renderer import finish_monitor
        monitor = RendererMonitor(PID)
        def late_close():
            monitor.fail("renderer-remove-view-at", "1791065526.176")
        monitor.close = late_close
        with self.assertRaisesRegex(RendererFailure, "renderer-remove-view-at"):
            finish_monitor(monitor)

    def test_physical_device_is_rejected_before_install_or_clear(self):
        from run_renderer import RendererDevice, verify_emulator
        with tempfile.TemporaryDirectory() as temporary:
            device = RendererDevice("physical-serial", Path(temporary), {"accounts": {"resident-mobile": {}}, "forbidden": []}, "A" * 32)
            with patch.object(device, "raw") as raw:
                with self.assertRaises(RendererFailure):
                    verify_emulator(device)
                raw.assert_not_called()

    def test_private_and_public_paths_require_explicit_disposable_ci(self):
        from run_renderer import guarded_directory
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            private = root / "private"; private.mkdir()
            with patch.dict("os.environ", {}, clear=True):
                with self.assertRaises(RendererFailure):
                    guarded_directory(private)
            env = {"CI": "true", "GITHUB_ACTIONS": "true", "RUNNER_TEMP": str(root),
                   "ANDROID_RENDERER_DISPOSABLE_DB": "1", "ANDROID_DOMAIN_DISPOSABLE_DB": "1"}
            with patch.dict("os.environ", env):
                self.assertEqual(guarded_directory(private), private)
                with self.assertRaises(RendererFailure):
                    guarded_directory(root)
                with self.assertRaises(RendererFailure):
                    guarded_directory(root.parent)
                with self.assertRaises(RendererFailure):
                    guarded_directory(private, create=True)

    def test_only_single_sanitized_json_is_uploaded(self):
        workflow = (Path(__file__).resolve().parents[2] / ".github/workflows/android-renderer.yml").read_text()
        self.assertIn('path: ${{ env.ANDROID_RENDERER_PUBLIC }}/result.json', workflow)
        self.assertNotIn('continue-on-error', workflow)
        self.assertNotIn('scripts/android-auth-smoke/diagnostics.py', workflow)
        self.assertIn('force-avd-creation: true', workflow)
        self.assertIn('ANDROID_RENDERER_DISPOSABLE_DB: "1"', workflow)

    def test_complete_closed_journey_can_be_exported(self):
        markers = []
        required = {"startup": "launch", "login": "tap", "building": "tap", "finance": "tap", "expand": "tap", "requests": "tap"}
        for phase in ["startup", "login", "building", "notices", "finance", "expand", "requests", "final"]:
            for kind, boundary in [("phase", "before"), *([(required[phase], "before"), (required[phase], "after")] if phase in required else []), ("phase", "after")]:
                markers.append({"sequence": len(markers) + 1, "phase": phase, "boundary": boundary, "kind": kind, "deviceTime": "1791065526.176"})
        report = public_report(True, "passed", PID, markers, None, True, SOURCE)
        self.assertTrue(report["passed"])
        self.assertNotIn("preflightDiagnostic", report)
        with self.assertRaises(RendererFailure):
            public_report(True, "passed", PID, markers[:-1], None, True, SOURCE)

    def test_source_metadata_rejects_private_values_extra_fields_and_wrong_platform(self):
        for changes in [{"commit": SECRET}, {"apkSha256": SECRET}, {"reactNative": SECRET}, {"androidApi": True},
                        {"abi": "arm64-v8a"}, {"privatePath": SECRET}, {"reactNative": "0.87.2"}]:
            with self.assertRaises(RendererFailure):
                public_report(False, "ui-incomplete", PID, [], None, False, dict(SOURCE, **changes))

    def test_source_is_computed_from_apk_and_real_git_not_environment_digest(self):
        from run_renderer import source_metadata
        with tempfile.TemporaryDirectory() as temporary:
            apk = Path(temporary) / "verification.apk"; apk.write_bytes(b"fixture-APK-bytes")
            actual = hashlib.sha256(apk.read_bytes()).hexdigest()
            build = {"app": "resident-mobile", "package": "com.predioon.resident", "gitSha": "a" * 40,
                     "architecture": "x86_64", "mode": "release", "apiOrigin": "https://10.0.2.2:3443", "sha256": actual}
            (apk.parent / "build.json").write_text(json.dumps(build))
            with patch("run_renderer.subprocess.run") as git, patch.dict(os.environ, {"GITHUB_SHA": SECRET, "APK_SHA256": SECRET}):
                git.return_value.returncode = 0; git.return_value.stdout = "a" * 40 + "\n"
                source = source_metadata(apk)
                self.assertEqual(source, dict(SOURCE, apkSha256=actual))
                build["sha256"] = "c" * 64
                (apk.parent / "build.json").write_text(json.dumps(build))
                with self.assertRaises(RendererFailure):
                    source_metadata(apk)

    def test_invalid_cli_never_echoes_private_arguments_or_traceback(self):
        from run_renderer import main
        output, errors = io.StringIO(), io.StringIO()
        import contextlib
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            self.assertEqual(main(["--private", SECRET, "--unknown", SECRET]), 1)
        self.assertEqual(errors.getvalue(), "")
        self.assertNotIn(SECRET, output.getvalue())
        self.assertEqual(json.loads(output.getvalue())["category"], "configuration-rejected")

    def test_service_cleanup_rejects_reused_pid_without_signaling(self):
        import services
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "api.process.json").write_text(json.dumps({"pid": 1234, "group": 1234, "session": 1234, "start": "100"}))
            with patch.object(services, "identity", return_value={"pid": 1234, "group": 1234, "session": 1234, "start": "200"}), patch.object(services.os, "killpg", create=True) as signal:
                with self.assertRaises(ValueError):
                    services.stop(root)
                signal.assert_not_called()

    def test_service_cleanup_signals_only_recorded_group(self):
        import services
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            recorded = {"pid": 1234, "group": 1234, "session": 1234, "start": "100"}
            (root / "api.process.json").write_text(json.dumps(recorded))
            with patch.object(services, "identity", return_value=recorded), patch.object(services.os, "killpg", create=True) as signal:
                services.stop(root)
                signal.assert_called_once_with(1234, services.signal.SIGTERM)

    def test_real_tls_proxy_forwards_reads_but_never_domain_mutations(self):
        if sys.platform == "win32" and not shutil.which("openssl"):
            self.skipTest("OpenSSL is not installed in Windows")
        from proxy_renderer import make_handler
        from tls import create_certificates
        class Upstream(BaseHTTPRequestHandler):
            received = []
            def do_GET(self):
                self.received.append((self.command, self.path))
                body = b'{"ok":true,"service":"predioon-api"}'
                self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
            def do_POST(self):
                self.received.append((self.command, self.path))
                self.send_response(204); self.end_headers()
            def log_message(self, *_): pass
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ca = create_certificates(root / "tls")
            upstream = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
            proxy = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(upstream.server_port, allows))
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(root / "tls/server.pem", root / "tls/server.key")
            proxy.socket = context.wrap_socket(proxy.socket, server_side=True)
            threads = [threading.Thread(target=server.serve_forever, daemon=True) for server in [upstream, proxy]]
            for thread in threads: thread.start()
            client = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=str(ca))))
            try:
                origin = f"https://127.0.0.1:{proxy.server_port}"
                with client.open(origin + "/finance", timeout=3) as response:
                    self.assertEqual(response.status, 200)
                for path in ["/occurrences", "/commands", "/auth/password"]:
                    with self.assertRaises(urllib.error.HTTPError) as failure:
                        client.open(urllib.request.Request(origin + path, data=b'{}', method="POST"), timeout=3)
                    self.assertEqual(failure.exception.code, 403)
                self.assertEqual(Upstream.received, [("GET", "/finance")])
            finally:
                for server in [proxy, upstream]: server.shutdown(); server.server_close()
                for thread in threads: thread.join(timeout=3)

    def test_read_only_policy_denies_domain_writes_and_physical_commands(self):
        for method, path in [("POST", "/occurrences"), ("PATCH", "/occurrences/11111111-1111-1111-1111-111111111111"),
                             ("POST", "/commands"), ("POST", "/auth/password"), ("GET", "/telemetry/latest"),
                             ("GET", "/finance?foreign=true"), ("GET", "https://external.invalid/health")]:
            self.assertFalse(allows(method, path), (method, path))
        for path in ["/health", "/auth/me", "/buildings", "/v1/authorization", "/overview/building", "/notices", "/finance", "/occurrences", "/features/buildings/android-domain-building-123"]:
            self.assertTrue(allows("GET", path), path)
        for path in ["/auth/login", "/auth/refresh", "/auth/logout"]:
            self.assertTrue(allows("POST", path), path)


    def assert_preflight(self, stage, category, marker_count):
        import run_renderer as runner
        from test_domains_prefix import preflight_failure
        report = preflight_failure(runner, stage)
        self.assertEqual(report.get("preflightDiagnostic"), {"stage": stage, "category": category})
        self.assertEqual(report["category"], category)
        self.assertIsNone(report["pid"])
        self.assertIsNone(report["firstFailure"])
        self.assertEqual(len(report["markers"]), marker_count)


    def test_immediate_security_failure_blocks_next_renderer_gesture(self):
        from run_renderer import RendererDevice
        for kind, category in [("private-domain-content", "privacy-rejected"), ("credential-exposure", "credential-exposure")]:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as folder:
                device = RendererDevice("emulator-5554", Path(folder), {"accounts": {"resident-mobile": {}}, "forbidden": []}, "A" * 32)
                device.monitor = RendererMonitor(PID)
                device.record_security_failure(kind)
                with patch.object(device, "raw", side_effect=lambda *args, **kwargs: str(PID) if args[:2] == ("shell", "pidof") else "") as raw:
                    with self.assertRaisesRegex(RendererFailure, category):
                        device.adb("shell", "input", "tap", "1", "2")
                    raw.assert_not_called()

    def test_complete_success_with_stale_stage_still_exports_previous_keys(self):
        import contextlib
        import run_renderer as runner
        from test_domains_prefix import PrefixTests
        with tempfile.TemporaryDirectory() as folder:
            private, public, env = PrefixTests().main_fixture(Path(folder)); output = io.StringIO()
            def complete(device, _apk, _fixture):
                device.monitor = RendererMonitor(PID)
                device.preflight_stage = "home-readiness"
                required = {"startup": "launch", "login": "tap", "building": "tap", "finance": "tap", "expand": "tap", "requests": "tap"}
                for phase in ["startup", "login", "building", "notices", "finance", "expand", "requests", "final"]:
                    pairs = [("phase", "before"), *([(required[phase], "before"), (required[phase], "after")] if phase in required else []), ("phase", "after")]
                    for kind, boundary in pairs:
                        device.markers.append({"sequence": len(device.markers) + 1, "phase": phase, "boundary": boundary, "kind": kind, "deviceTime": "1791065526.176"})
            with patch.dict(os.environ, env), patch.object(runner, "source_metadata", return_value=SOURCE), \
                 patch.object(runner, "run", side_effect=complete), contextlib.redirect_stdout(output):
                self.assertEqual(runner.main(["--private", str(private), "--public", str(public)]), 0)
            report = json.loads((public / "result.json").read_text())
            self.assertTrue(report["passed"])
            self.assertEqual(set(report), {"schema", "app", "passed", "category", "pid", "markers", "firstFailure", "domainSnapshotUnchanged", "source"})

    def test_main_emulator_failure_has_closed_stage(self):
        self.assert_preflight("emulator-check", "configuration-rejected", 0)

    def test_main_home_failure_has_closed_stage(self):
        self.assert_preflight("home-readiness", "ui-incomplete", 0)


    def test_home_privacy_and_credential_failures_have_closed_prebind_stage(self):
        import run_renderer as runner
        from test_domains_prefix import preflight_failure
        for kind, category in [("private-domain-content", "privacy-rejected"), ("credential-exposure", "credential-exposure")]:
            report = preflight_failure(runner, "home-readiness", kind)
            self.assertEqual(report.get("preflightDiagnostic"), {"stage": "home-readiness", "category": category})
            self.assertIsNone(report["firstFailure"])
            self.assertIsNone(report["pid"])
            self.assertEqual(report["markers"], [])

    def test_bound_monitor_start_failure_in_both_runners_never_gets_preflight_diagnostic(self):
        import contextlib
        import run_renderer as runner
        import run_domains_prefix as prefix
        from test_domains_prefix import PrefixTests, FakeDevice, INITIAL
        for module, constructor, origin in [(runner, "RendererDevice", "source_metadata"), (prefix, "PrefixDevice", "checked_source")]:
            with self.subTest(runner=module.__name__), tempfile.TemporaryDirectory() as folder:
                private, public, env = PrefixTests().main_fixture(Path(folder)); output = io.StringIO(); devices = []
                def factory(serial, directory, data, password):
                    device = FakeDevice(directory); devices.append(device); return device
                with patch.dict(os.environ, env), patch.object(module, origin, return_value=SOURCE), \
                     patch.object(module, constructor, side_effect=factory), patch.object(module, "fixture_action", return_value=INITIAL) as database, \
                     patch.object(RendererMonitor, "start", side_effect=RendererFailure("diagnostic-stream-failed")), contextlib.redirect_stdout(output):
                    self.assertEqual(module.main(["--private", str(private), "--public", str(public)]), 1)
                report = json.loads((public / "result.json").read_text())
                self.assertEqual(report["category"], "diagnostic-stream-failed")
                self.assertEqual(report["pid"], PID)
                self.assertNotIn("preflightDiagnostic", report)
                self.assertEqual(devices[0].steps, [])
                self.assertEqual(list((private / "ui-private").iterdir()), [])
                self.assertEqual(database.call_count, 1)
                self.assertEqual(len(report["markers"]), 3)
                self.assertNotIn(SECRET, output.getvalue())

    def test_main_install_failure_has_closed_stage(self):
        self.assert_preflight("apk-install", "adb-failed", 0)

    def test_main_initial_snapshot_failure_has_closed_stage(self):
        self.assert_preflight("initial-snapshot", "ui-incomplete", 0)

    def test_main_launch_failure_has_closed_stage(self):
        self.assert_preflight("app-launch", "adb-failed", 2)

    def test_main_pid_failure_has_closed_stage(self):
        self.assert_preflight("pid-bind", "process-changed", 3)

    def security_failure_order(self, initial, later):
        import contextlib
        import run_renderer as runner
        from test_domains_prefix import PrefixTests, native
        with tempfile.TemporaryDirectory() as folder:
            private, public, env = PrefixTests().main_fixture(Path(folder))
            output = io.StringIO()
            def reject(device, _apk, _fixture):
                device.monitor = RendererMonitor(PID)
                device.preflight_stage = "home-readiness"
                if initial == "native":
                    device.monitor.observe(native())
                device.record_security_failure("credential-exposure" if initial == "credential" else "private-domain-content")
                raise runner.PrivacyViolation(SECRET)
            def finish(monitor):
                if later == "native":
                    monitor.observe(native())
                elif later == "diagnostic":
                    monitor.fail("diagnostic-stream-failed")
                monitor.check()
            with patch.dict(os.environ, env), patch.object(runner, "source_metadata", return_value=SOURCE), \
                 patch.object(runner, "run", side_effect=reject), patch.object(runner, "finish_monitor", side_effect=finish), \
                 patch.object(runner.RendererDevice, "raw") as raw, contextlib.redirect_stdout(output):
                self.assertEqual(runner.main(["--private", str(private), "--public", str(public)]), 1)
                raw.assert_not_called()
            report = json.loads((public / "result.json").read_text())
            self.assertFalse(report["passed"])
            self.assertFalse(report["domainSnapshotUnchanged"])
            self.assertNotIn("preflightDiagnostic", report)
            self.assertEqual(list((private / "ui-private").iterdir()), [])
            self.assertEqual([p.name for p in public.iterdir()], ["result.json"])
            self.assertNotIn(SECRET, output.getvalue())
            self.assertNotIn(SECRET, json.dumps(report))
            return report

    def test_privacy_before_late_native_failure_preserves_first_category(self):
        report = self.security_failure_order("privacy", "native")
        self.assertEqual(report["category"], "privacy-rejected")
        self.assertEqual(report["firstFailure"], {"category": "privacy-rejected", "deviceTime": None})

    def test_native_before_privacy_preserves_first_category(self):
        report = self.security_failure_order("native", None)
        self.assertEqual(report["category"], "renderer-missing-view-state")
        self.assertEqual(report["firstFailure"], {"category": "renderer-missing-view-state", "deviceTime": "1791065526.176"})

    def test_credential_before_cleanup_diagnostic_preserves_first_category(self):
        report = self.security_failure_order("credential", "diagnostic")
        self.assertEqual(report["category"], "credential-exposure")
        self.assertEqual(report["firstFailure"], {"category": "credential-exposure", "deviceTime": None})

    def test_privacy_without_later_failure_is_recorded_immediately(self):
        report = self.security_failure_order("privacy", None)
        self.assertEqual(report["category"], "privacy-rejected")
        self.assertEqual(report["firstFailure"], {"category": "privacy-rejected", "deviceTime": None})

    def startup_markers(self, size):
        return [{"sequence": i + 1, "phase": "startup", "boundary": boundary, "kind": kind,
                 "deviceTime": "1791065526.176"} for i, (boundary, kind) in enumerate(
                 [("before", "phase"), ("before", "launch"), ("after", "launch")][:size])]

    def test_preflight_export_allows_only_closed_stage_category_pairs(self):
        from monitor import CATEGORIES
        pairs = {"emulator-check": ["configuration-rejected", "adb-failed", "diagnostic-stream-failed", "harness-failed"],
                 "home-readiness": ["ui-incomplete", "adb-failed", "privacy-rejected", "credential-exposure", "harness-failed"],
                 "apk-install": ["adb-failed", "harness-failed"],
                 "initial-snapshot": ["ui-incomplete", "fixture-rejected", "harness-failed"],
                 "app-launch": ["adb-failed", "ui-incomplete", "configuration-rejected", "diagnostic-stream-failed", "harness-failed"],
                 "pid-bind": ["process-changed", "configuration-rejected", "adb-failed", "harness-failed"]}
        for stage, categories in pairs.items():
            for category in categories:
                for count in ([3] if stage == "pid-bind" else range(4) if stage == "app-launch" else [0]):
                    diagnostic = {"stage": stage, "category": category}
                    report = public_report(False, category, None, self.startup_markers(count), None, False, SOURCE,
                                           preflight_diagnostic=diagnostic)
                    self.assertEqual(report["preflightDiagnostic"], diagnostic)
            for category in CATEGORIES - set(categories):
                with self.assertRaises(RendererFailure):
                    public_report(False, category, None, self.startup_markers(3 if stage == "pid-bind" else 0), None, False, SOURCE,
                                  preflight_diagnostic={"stage": stage, "category": category})

    def test_preflight_export_rejects_private_values_extra_fields_and_incompatible_categories(self):
        from monitor import CATEGORIES
        valid = {"stage": "home-readiness", "category": "ui-incomplete"}
        for diagnostic in [dict(valid, stderr=SECRET), dict(valid, stage=SECRET), dict(valid, category=SECRET),
                           {}, [], SECRET, {"stage": "apk-install", "category": "ui-incomplete"},
                           {"stage": "initial-snapshot", "category": "privacy-rejected"}]:
            with self.assertRaises(RendererFailure):
                public_report(False, "ui-incomplete", None, [], None, False, SOURCE, preflight_diagnostic=diagnostic)
        for category in CATEGORIES - {"ui-incomplete", "adb-failed", "privacy-rejected", "credential-exposure", "harness-failed"}:
            with self.assertRaises(RendererFailure):
                public_report(False, category, None, [], None, False, SOURCE,
                              preflight_diagnostic={"stage": "home-readiness", "category": category})

    def test_preflight_export_rejects_success_bound_pid_first_failure_and_category_mismatch(self):
        diagnostic = {"stage": "home-readiness", "category": "ui-incomplete"}
        for passed, category, pid, failure, unchanged in [
            (True, "passed", PID, None, True), (False, "ui-incomplete", PID, None, False),
            (False, "ui-incomplete", None, {"category": "privacy-rejected", "deviceTime": None}, False),
            (False, "adb-failed", None, None, False), (False, "ui-incomplete", None, None, True)]:
            with self.assertRaises(RendererFailure):
                public_report(passed, category, pid, [], failure, unchanged, SOURCE, preflight_diagnostic=diagnostic)

    def test_preflight_export_rejects_illegal_startup_prefix_or_wrong_stage_markers(self):
        valid = self.startup_markers(3)
        invalid = [valid + [{"sequence": 4, "phase": "startup", "boundary": "after", "kind": "phase", "deviceTime": "1791065526.176"}],
                   [dict(valid[0], phase="login")], [dict(valid[0], kind="launch")],
                   [valid[0], dict(valid[1], boundary="after")], [valid[0], dict(valid[1], kind="tap")]]
        for markers in invalid:
            with self.assertRaises(RendererFailure):
                public_report(False, "adb-failed", None, markers, None, False, SOURCE,
                              preflight_diagnostic={"stage": "app-launch", "category": "adb-failed"})
        for stage in ["emulator-check", "home-readiness", "apk-install", "initial-snapshot"]:
            with self.assertRaises(RendererFailure):
                public_report(False, "harness-failed", None, valid[:1], None, False, SOURCE,
                              preflight_diagnostic={"stage": stage, "category": "harness-failed"})
        for count in range(3):
            with self.assertRaises(RendererFailure):
                public_report(False, "process-changed", None, self.startup_markers(count), None, False, SOURCE,
                              preflight_diagnostic={"stage": "pid-bind", "category": "process-changed"})

    def test_legacy_failure_report_has_exact_previous_keys(self):
        report = public_report(False, "ui-incomplete", None, [], None, False, SOURCE)
        self.assertEqual(set(report), {"schema", "app", "passed", "category", "pid", "markers", "firstFailure", "domainSnapshotUnchanged", "source"})

    def test_source_failure_never_constructs_device_or_adds_preflight_stage(self):
        import contextlib
        import run_renderer as runner
        from test_domains_prefix import PrefixTests
        with tempfile.TemporaryDirectory() as folder:
            private, public, env = PrefixTests().main_fixture(Path(folder)); output = io.StringIO()
            with patch.dict(os.environ, env), patch.object(runner, "source_metadata", side_effect=RendererFailure("configuration-rejected")), \
                 patch.object(runner, "RendererDevice") as constructor, contextlib.redirect_stdout(output):
                self.assertEqual(runner.main(["--private", str(private), "--public", str(public)]), 1)
                constructor.assert_not_called()
            report = json.loads((public / "result.json").read_text())
            self.assertNotIn("preflightDiagnostic", report)
            self.assertFalse((private / "ui-private").exists())


if __name__ == "__main__":
    unittest.main()
