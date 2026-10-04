"""One native resident journey; the first renderer/security failure is terminal."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

from monitor import PHASES, RendererFailure, RendererMonitor, marker_time, public_report
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/android-domain-smoke"))
from run_domains import DomainDevice, PrivacyViolation, assert_snapshot, fixture_action
from run import crash_evidence


class ClosedParser(argparse.ArgumentParser):
    def error(self, _message):
        raise RendererFailure("configuration-rejected")


def source_metadata(apk):
    # Digests are computed from this known APK. Never export an environment or
    # user-supplied hash that could merely disguise a credential as hex.
    if apk.is_symlink() or not apk.is_file() or not 0 < apk.stat().st_size <= 256 * 1024 * 1024:
        raise RendererFailure("configuration-rejected")
    build_file = apk.parent / "build.json"
    if build_file.is_symlink() or not build_file.is_file() or build_file.stat().st_size > 65536:
        raise RendererFailure("configuration-rejected")
    git = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, timeout=10)
    commit = git.stdout.strip()
    if git.returncode or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise RendererFailure("configuration-rejected")
    digest = hashlib.sha256()
    with apk.open("rb") as binary:
        while chunk := binary.read(1024 * 1024):
            digest.update(chunk)
    sha = digest.hexdigest()
    build = json.loads(build_file.read_text(encoding="utf-8"))
    expected = {"app": "resident-mobile", "package": "com.predioon.resident", "gitSha": commit,
                "architecture": "x86_64", "mode": "release", "apiOrigin": "https://10.0.2.2:3443", "sha256": sha}
    if not isinstance(build, dict) or any(build.get(key) != value for key, value in expected.items()):
        raise RendererFailure("configuration-rejected")
    package = json.loads((ROOT / "apps/resident-mobile/package.json").read_text(encoding="utf-8"))
    if package.get("dependencies", {}).get("react-native") != "0.87.1":
        raise RendererFailure("configuration-rejected")
    return {"commit": commit, "apkSha256": sha, "reactNative": "0.87.1", "androidApi": 35, "abi": "x86_64"}


def guarded_directory(value, *, create=False):
    if (os.environ.get("CI") != "true" or os.environ.get("GITHUB_ACTIONS") != "true" or
            os.environ.get("ANDROID_RENDERER_DISPOSABLE_DB") != "1" or
            os.environ.get("ANDROID_DOMAIN_DISPOSABLE_DB") != "1"):
        raise RendererFailure("configuration-rejected")
    try:
        base = Path(os.environ.get("RUNNER_TEMP", "/missing-runner-temp")).resolve(strict=True)
        candidate = value.absolute()
        for part in [candidate, *candidate.parents]:
            if part.is_symlink():
                raise RendererFailure("configuration-rejected")
        resolved = candidate.resolve()
        if resolved == base or not resolved.is_relative_to(base):
            raise RendererFailure("configuration-rejected")
        if create:
            resolved.mkdir(mode=0o700, parents=False, exist_ok=False)
        elif not resolved.is_dir():
            raise RendererFailure("configuration-rejected")
    except OSError:
        raise RendererFailure("configuration-rejected") from None
    return resolved


class RendererDevice(DomainDevice):
    def __init__(self, serial, output, fixture, password):
        super().__init__(serial, "resident-mobile", output, fixture, password)
        self.monitor = None
        self.phase = "preflight"
        self.markers = []

    def raw(self, *args, **kwargs):
        try:
            return super().adb(*args, **kwargs)
        except Exception:
            raise RendererFailure("adb-failed") from None

    def mark(self, boundary, kind):
        if self.monitor:
            self.monitor.check()
        sequence = len(self.markers) + 1
        value = f"seq={sequence},phase={self.phase},boundary={boundary},kind={kind}"
        self.raw("shell", "log", "-p", "i", "-t", "PredioonRenderer", value)
        source = self.raw("logcat", "-d", "-v", "epoch", "-s", "PredioonRenderer:I", "*:S")
        instant = marker_time(source, value)
        self.markers.append({"sequence": sequence, "phase": self.phase, "boundary": boundary, "kind": kind, "deviceTime": instant})
        if self.monitor:
            self.monitor.snapshot(self.raw)

    def set_phase(self, phase):
        if phase not in PHASES:
            raise RendererFailure("configuration-rejected")
        if self.monitor:
            self.monitor.check()
        self.phase = phase
        self.mark("before", "phase")

    def adb(self, *args, **kwargs):
        if self.monitor:
            self.monitor.snapshot(self.raw)
        kind = None
        if args[:3] == ("shell", "input", "tap"):
            kind = "tap"
        elif args[:3] == ("shell", "input", "swipe"):
            kind = "swipe"
        elif args[:3] == ("shell", "input", "text"):
            kind = "text"
        elif args[:3] == ("shell", "input", "keyevent"):
            kind = "back"
        elif args[:3] == ("shell", "am", "start") and self.phase == "startup":
            kind = "launch"
        if kind:
            self.mark("before", kind)
        result = self.raw(*args, **kwargs)
        if self.monitor:
            self.monitor.snapshot(self.raw)
        if kind:
            self.mark("after", kind)
        return result

    def screen(self, _name):
        # No screenshots are collected, including the first rejected tree.
        return

    def collect(self):
        # The parent domain harness exports raw diagnostics; this recorte does not.
        return

    def assert_no_crash(self):
        if not self.monitor:
            raise RendererFailure("diagnostic-stream-failed")
        self.monitor.snapshot(self.raw)
        crash = self.raw("logcat", "-b", "crash", "-d")
        main = self.raw("logcat", "-d", "-v", "threadtime")
        exits = self.raw("shell", "dumpsys", "activity", "exit-info", self.package)
        if crash_evidence(self.package, crash, main, exits):
            self.monitor.fail("crash-or-anr")
        self.monitor.snapshot(self.raw)


def verify_emulator(device):
    if (not re.fullmatch(r"emulator-[0-9]+", device.serial) or
            device.raw("shell", "getprop", "ro.kernel.qemu").strip() != "1" or
            device.raw("shell", "getprop", "sys.boot_completed").strip() != "1"):
        raise RendererFailure("configuration-rejected")
    listed = [line.split() for line in device.raw("devices").splitlines()[1:] if line.strip()]
    if listed != [[device.serial, "device"]]:
        raise RendererFailure("configuration-rejected")
    if (device.raw("shell", "getprop", "ro.build.version.sdk").strip() != "35" or
            device.raw("shell", "getprop", "ro.product.cpu.abi").strip() != "x86_64"):
        raise RendererFailure("configuration-rejected")
    help_text = device.raw("logcat", "--help")
    if "--pid" not in help_text or "epoch" not in help_text:
        raise RendererFailure("diagnostic-stream-failed")


def run(device, apk, fixture_file):
    verify_emulator(device)
    device.wait_environment_ready()  # Same HOME/boot observations and deadlines.
    device.raw("install", "-r", str(apk), timeout=120)
    device.raw("shell", "pm", "clear", device.package)
    device.raw("logcat", "-c")  # Once, before startup; never clear a negative.
    assert_snapshot(fixture_action(fixture_file, "snapshot"), "initial")
    device.set_phase("startup")
    device.launch()
    value = device.raw("shell", "pidof", device.package).strip()
    if not value.isascii() or not value.isdecimal():
        raise RendererFailure("process-changed")
    device.monitor = RendererMonitor(int(value))
    device.monitor.start(device.serial)
    device.monitor.snapshot(device.raw)  # Includes startup history before PID binding.
    device.mark("after", "phase")
    device.set_phase("login")
    device.login("login")  # One submission; existing bounded input batches.
    device.mark("after", "phase")
    device.set_phase("building")
    device.enter_building("building")
    device.mark("after", "phase")
    device.set_phase("notices")
    device.wait_domain("notices", [device.fixture["labels"]["notice"]])
    device.mark("after", "phase")
    device.set_phase("finance")
    device.tab("Transparência")
    device.wait_statement("finance", device.fixture["labels"]["report"])
    device.mark("after", "phase")
    device.set_phase("expand")
    device.tap("Ver lançamentos (1)")
    device.scroll()
    device.wait_domain("finance-entry", [device.fixture["labels"]["entry"]])
    device.mark("after", "phase")
    device.set_phase("requests")
    device.top()
    device.tab("Solicitações")
    device.wait_domain("own-ticket", [device.fixture["labels"]["ownTicket"]])
    device.mark("after", "phase")
    device.set_phase("final")
    assert_snapshot(fixture_action(fixture_file, "snapshot"), "initial")
    device.assert_no_crash()
    device.mark("after", "phase")
    device.monitor.snapshot(device.raw)


def finish_monitor(monitor):
    try:
        monitor.check()
    finally:
        try:
            monitor.close()
        except Exception:
            monitor.fail("diagnostic-stream-failed")
    monitor.check()  # A late first negative cannot turn into a successful export.


def main(arguments=None):
    device, public, source = None, None, None
    passed, category, unchanged = False, "configuration-rejected", False
    try:
        parser = ClosedParser(description=__doc__, add_help=False)
        parser.add_argument("--serial", default="emulator-5554")
        parser.add_argument("--private", type=Path, required=True)
        parser.add_argument("--public", type=Path, required=True)
        args = parser.parse_args(arguments)
        private = guarded_directory(args.private)
        public = guarded_directory(args.public, create=True)
        if public.is_relative_to(private) or private.is_relative_to(public):
            raise RendererFailure("configuration-rejected")
        password = os.environ.get("ANDROID_AUTH_PASSWORD", "")
        if not re.fullmatch(r"[A-Za-z0-9]{16,}", password):
            raise RendererFailure("configuration-rejected")
        fixture_file = private / "fixture.json"
        if fixture_file.is_symlink() or not fixture_file.is_file() or fixture_file.stat().st_size > 65536:
            raise RendererFailure("configuration-rejected")
        fixture = json.loads(fixture_file.read_text(encoding="utf-8"))
        apk = private / "resident-mobile/verification.apk"
        source = source_metadata(apk)
        observations = private / "ui-private"
        observations.mkdir(mode=0o700, exist_ok=False)
        device = RendererDevice(args.serial, observations, fixture, password)
        run(device, apk, fixture_file.resolve())
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
        failure = device.monitor.failure if device and device.monitor else None
        if device and device.security_failed:
            passed, unchanged = False, False
            category = "credential-exposure" if device.security_failure["kind"] == "credential-exposure" else "privacy-rejected"
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
