"""Original resident domain prefix, with private captures and terminal renderer gates."""
import json
import os
from pathlib import Path
import re
import sys
import time
import xml.etree.ElementTree as ET

from monitor import RendererFailure, RendererMonitor, marker_time, public_report
from run_renderer import (ClosedParser, ROOT, finish_monitor, guarded_directory,
                          source_metadata, verify_emulator)
from run_domains import DomainDevice, PrivacyViolation, assert_snapshot, fixture_action, inspect_domain
from run_auth import center, one


class PrefixDevice(DomainDevice):
    def __init__(self, serial, output, fixture, password):
        super().__init__(serial, "resident-mobile", output, fixture, password)
        self.monitor = None
        self.phase = "preflight"
        self.markers = []
        self.marked_actions = set()

    def record_security_failure(self, kind):
        super().record_security_failure(kind)
        if self.monitor:
            category = "credential-exposure" if self.security_failure["kind"] == "credential-exposure" else "privacy-rejected"
            self.monitor.fail(category)

    def check(self):
        if self.monitor:
            self.monitor.check()
        if self.security_failed:
            category = "credential-exposure" if self.security_failure["kind"] == "credential-exposure" else "privacy-rejected"
            if self.monitor:
                self.monitor.fail(category)
                self.monitor.check()
            raise RendererFailure(category)

    def raw(self, *args, **kwargs):
        try:
            return super().adb(*args, **kwargs)
        except Exception:
            raise RendererFailure("adb-failed") from None

    def same_process(self):
        self.check()
        if self.monitor:
            value = self.raw("shell", "pidof", self.package, required=False).strip()
            if value != str(self.monitor.pid):
                self.monitor.fail("process-changed")
            self.check()

    def mark(self, boundary, kind):
        self.check()
        value = f"seq={len(self.markers) + 1},phase={self.phase},boundary={boundary},kind={kind}"
        self.raw("shell", "log", "-p", "i", "-t", "PredioonRenderer", value)
        self.check()
        source = self.raw("logcat", "-d", "-v", "epoch", "-s", "PredioonRenderer:I", "*:S")
        self.check()
        self.markers.append({"sequence": len(self.markers) + 1, "phase": self.phase,
                             "boundary": boundary, "kind": kind, "deviceTime": marker_time(source, value)})

    def set_phase(self, phase):
        if phase not in {"startup", "login", "building", "notices", "finance", "expand", "requests", "final"}:
            raise RendererFailure("configuration-rejected")
        self.same_process()
        self.phase = phase
        self.mark("before", "phase")

    def adb(self, *args, **kwargs):
        self.check()
        gesture = args[:2] == ("shell", "input") or args[:3] == ("shell", "am", "start")
        if gesture:
            self.same_process()
        required = {"startup": "launch", "login": "tap", "building": "tap", "finance": "tap",
                    "expand": "tap", "requests": "tap"}
        kind = "tap" if args[:3] == ("shell", "input", "tap") else (
            "launch" if args[:3] == ("shell", "am", "start") else None)
        record = kind is not None and required.get(self.phase) == kind and self.phase not in self.marked_actions
        if record:
            self.mark("before", kind)
        result = self.raw(*args, **kwargs)
        self.check()
        if record:
            self.mark("after", kind)
            self.marked_actions.add(self.phase)
        return result

    def capture(self, phase, source, *, image_first=False):
        if not re.fullmatch(r"[0-9]{2}-[a-z0-9-]{1,60}", phase):
            raise RendererFailure("configuration-rejected")
        self.check()
        self.check_observation_security(source)
        self.same_process()
        self.check()
        if image_first:
            self.screen(phase)
            self.check()
        (self.output / f"{phase}.xml").write_text(source, encoding="utf-8")
        if not image_first:
            self.screen(phase)
        self.check()
        self.steps.append({"phase": phase, "passed": True})

    def screen(self, phase):
        if not re.fullmatch(r"[0-9]{2}-[a-z0-9-]{1,60}", phase):
            raise RendererFailure("configuration-rejected")
        self.same_process()
        image = self.raw("exec-out", "screencap", "-p", binary=True)
        self.check()
        (self.output / f"{phase}.png").write_bytes(image)

    def collect(self):
        # Never invoke the inherited collector: it dumps the shared foreground
        # and global buffers, including after a terminal renderer/privacy failure.
        return

    def wait_for(self, phase, inspect):
        deadline, error = time.monotonic() + 60, "Expected domain screen did not render"
        while time.monotonic() < deadline:
            self.check()
            self.assert_no_crash()
            try:
                source = self.hierarchy()
                self.check_observation_security(source)
                result = inspect(source)
            except PrivacyViolation as cause:
                self.record_security_failure("forbidden-domain-action" if str(cause) == "Forbidden native domain action is present" else "private-domain-content")
                raise RendererFailure("privacy-rejected") from None
            except (AssertionError, ET.ParseError) as cause:
                if "Android system dialog" in str(cause):
                    raise RendererFailure("ui-incomplete") from None
                error = str(cause)
                time.sleep(1)
            else:
                self.capture(phase, source)
                return result
        raise AssertionError(f"{phase}: {error}")

    def wait_statement(self, phase, title):
        for attempt in range(9):
            self.check()
            self.assert_no_crash()
            try:
                source = self.hierarchy()
                self.check_observation_security(source)
                nodes = inspect_domain(source, self.package, self.account["buildingName"], (), self.forbidden_labels())
                report = one(nodes, lambda n: n.get("class") == "android.widget.TextView" and n.get("text") == title,
                             "published statement " + title)
                center(report)
                from assertions import action_node
                action_node(nodes, "Ver lançamentos (1)")
            except PrivacyViolation:
                self.record_security_failure("private-domain-content")
                raise RendererFailure("privacy-rejected") from None
            except (AssertionError, ET.ParseError) as cause:
                if "Android system dialog" in str(cause):
                    raise RendererFailure("ui-incomplete") from None
                if attempt == 8:
                    raise
                self.scroll()
                time.sleep(0.5)
            else:
                self.capture(phase, source, image_first=True)
                return

    def assert_no_crash(self):
        self.same_process()
        super().assert_no_crash()
        self.check()


def run(device, apks, fixture_file):
    verify_emulator(device)
    device.wait_environment_ready()
    for app in ["resident-mobile", "operations-mobile"]:
        device.adb("install", "-r", str(apks / app / "verification.apk"), timeout=120)
        device.adb("shell", "pm", "clear", "com.predioon.resident" if app == "resident-mobile" else "com.predioon.operations")
    device.adb("logcat", "-c")
    assert_snapshot(fixture_action(fixture_file, "snapshot"), "initial")
    device.set_phase("startup")
    device.launch()
    value = device.raw("shell", "pidof", device.package).strip()
    if not value.isascii() or not value.isdecimal() or not 1 <= int(value) < 2 ** 31:
        raise RendererFailure("process-changed")
    device.monitor = RendererMonitor(int(value))
    device.monitor.start(device.serial)
    device.monitor.snapshot(device.raw)
    device.mark("after", "phase")
    labels = device.fixture["labels"]
    device.set_phase("login")
    device.login("01-login")
    device.mark("after", "phase")
    device.set_phase("building")
    device.enter_building("02-enter")
    device.mark("after", "phase")
    device.set_phase("notices")
    device.wait_domain("03-notices", [labels["notice"]])
    device.mark("after", "phase")
    device.set_phase("finance")
    device.tab("Transparência")
    device.wait_statement("04-finance", labels["report"])
    device.mark("after", "phase")
    device.set_phase("expand")
    device.tap("Ver lançamentos (1)")
    device.scroll()
    device.wait_domain("05-finance-entry", [labels["entry"]])
    device.mark("after", "phase")
    device.set_phase("requests")
    device.top()
    device.tab("Solicitações")
    device.wait_domain("06-own-ticket", [labels["ownTicket"]])
    device.mark("after", "phase")
    device.set_phase("final")
    assert_snapshot(fixture_action(fixture_file, "snapshot"), "initial")
    device.assert_no_crash()
    device.mark("after", "phase")
    device.monitor.snapshot(device.raw)


def checked_source(private):
    import hashlib
    for app in ["resident-mobile", "operations-mobile"]:
        folder = private / app
        if folder.is_symlink() or not folder.is_dir():
            raise RendererFailure("configuration-rejected")
    source = source_metadata(private / "resident-mobile/verification.apk")
    apk = private / "operations-mobile/verification.apk"
    metadata = apk.parent / "build.json"
    if (apk.is_symlink() or not apk.is_file() or not 0 < apk.stat().st_size <= 256 * 1024 * 1024 or
            metadata.is_symlink() or not metadata.is_file() or metadata.stat().st_size > 65536):
        raise RendererFailure("configuration-rejected")
    digest = hashlib.sha256()
    with apk.open("rb") as binary:
        while chunk := binary.read(1024 * 1024):
            digest.update(chunk)
    build = json.loads(metadata.read_text(encoding="utf-8"))
    expected = {"app": "operations-mobile", "package": "com.predioon.operations", "gitSha": source["commit"],
                "architecture": "x86_64", "mode": "release", "apiOrigin": "https://10.0.2.2:3443", "sha256": digest.hexdigest()}
    if not isinstance(build, dict) or any(build.get(k) != v for k, v in expected.items()):
        raise RendererFailure("configuration-rejected")
    package = json.loads((ROOT / "apps/operations-mobile/package.json").read_text(encoding="utf-8"))
    if package.get("dependencies", {}).get("react-native") != "0.87.1":
        raise RendererFailure("configuration-rejected")
    return source


def main(arguments=None):
    device, public, source = None, None, None
    passed, category, unchanged = False, "configuration-rejected", False
    try:
        parser = ClosedParser(description=__doc__, add_help=False)
        parser.add_argument("--serial", default="emulator-5554")
        parser.add_argument("--private", type=Path, required=True)
        parser.add_argument("--public", type=Path, required=True)
        args = parser.parse_args(arguments)
        private, public = guarded_directory(args.private), guarded_directory(args.public, create=True)
        if public.is_relative_to(private) or private.is_relative_to(public):
            raise RendererFailure("configuration-rejected")
        password = os.environ.get("ANDROID_AUTH_PASSWORD", "")
        if not re.fullmatch(r"[A-Za-z0-9]{16,}", password):
            raise RendererFailure("configuration-rejected")
        fixture_file = private / "fixture.json"
        if fixture_file.is_symlink() or not fixture_file.is_file() or fixture_file.stat().st_size > 65536:
            raise RendererFailure("configuration-rejected")
        fixture = json.loads(fixture_file.read_text(encoding="utf-8"))
        source = checked_source(private)
        observations = private / "ui-private"
        observations.mkdir(mode=0o700, exist_ok=False)
        device = PrefixDevice(args.serial, observations, fixture, password)
        run(device, private, fixture_file.resolve())
        passed, category, unchanged = True, "passed", True
    except RendererFailure as error:
        category = error.category
    except PrivacyViolation:
        category = "privacy-rejected"
    except AssertionError:
        category = "ui-incomplete"
    except Exception:
        category = "harness-failed"
    finally:
        if device and device.monitor:
            try:
                finish_monitor(device.monitor)
            except RendererFailure as error:
                passed, category, unchanged = False, error.category, False
        if device and device.security_failed:
            passed, unchanged = False, False
            category = "credential-exposure" if device.security_failure["kind"] == "credential-exposure" else "privacy-rejected"
        failure = device.monitor.failure if device and device.monitor else None
        if failure:
            passed, category, unchanged = False, failure["category"], False
        try:
            report = public_report(passed, category, device.monitor.pid if device and device.monitor else None,
                                   device.markers if device else [], failure, unchanged, source)
        except RendererFailure:
            passed = False
            report = public_report(False, "configuration-rejected", None, [], None, False)
        if public:
            try:
                with (public / "result.json").open("x", encoding="utf-8") as output:
                    json.dump(report, output, indent=2)
            except OSError:
                passed = False
                report = public_report(False, "configuration-rejected", None, [], None, False)
        print(json.dumps(report, separators=(",", ":")))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
