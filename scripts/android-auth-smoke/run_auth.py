"""Exercise two coinstalled release apps against the real isolated API and secure storage."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/android-smoke"))
from run import APPS, Device, center, inspect_login, matches, one, parse_nodes


def redact(source, password):
    source = source.replace(password, "[redacted-password]") if password else source
    source = re.sub(r"[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}", "[redacted-jwt]", source)
    return re.sub(r"(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{64}(?![A-Za-z0-9_-])", "[redacted-opaque-token]", source)


def inspect_profile(source, app, fixture):
    nodes = parse_nodes(source, APPS[app][0])
    account = fixture["accounts"][app]
    for label in [account["productTitle"], account["name"], account["email"], account["buildingName"], "Escolha o condomínio"]:
        if not any(matches(node, label) for node in nodes):
            raise AssertionError(f"Expected authenticated profile label is absent: {label}")
    for other_app, other in fixture["accounts"].items():
        if other_app != app and any(matches(node, value) for node in nodes for value in [other["email"], other["name"], other["buildingName"]]):
            raise AssertionError("Another product account or tenant is visible")
    if any(matches(node, "Senha") and node.get("class") == "android.widget.EditText" for node in nodes):
        raise AssertionError("Login field unexpectedly remained on the authenticated screen")
    return one(nodes, lambda node: matches(node, "Sair") and node.get("class") == "android.widget.Button", "logout button")


def expected_session(phase):
    sessions, active, refresh, rotations, logouts = {
        "invalid": (0, 0, 0, 0, 0), "login": (1, 1, 1, 0, 0),
        "restored": (1, 1, 2, 1, 0), "logout": (1, 0, 2, 1, 1),
        "relogin": (2, 1, 3, 1, 1), "final-logout": (2, 0, 3, 1, 2),
    }[phase]
    return {"sessions": sessions, "active_sessions": active, "refresh_tokens": refresh,
            "rotations": rotations, "logouts": logouts, "live_refresh_tokens": active}


class AuthDevice(Device):
    def __init__(self, serial, app, output, fixture, password):
        super().__init__(serial, app, output)
        self.fixture, self.password = fixture, password
        self.account = fixture["accounts"][app]

    def wait_for(self, phase, inspect):
        deadline = time.monotonic() + 60
        error = "Expected screen did not render"
        while time.monotonic() < deadline:
            self.assert_no_crash()
            try:
                source = self.hierarchy()
                if redact(source, self.password) != source:
                    raise AssertionError("Credentials leaked into the UI hierarchy")
                result = inspect(source)
                (self.output / f"{phase}.xml").write_text(source, encoding="utf-8")
                self.screen(phase)
                self.steps.append({"phase": phase, "passed": True})
                return result
            except (AssertionError, ET.ParseError) as cause:
                error = str(cause)
                time.sleep(1)
        raise AssertionError(f"{phase}: {error}")

    def profile(self, phase):
        return self.wait_for(phase, lambda source: inspect_profile(source, self.app, self.fixture))

    def login(self, phase, invalid=False):
        fields = self.wait_for(f"{phase}-blank", lambda source: inspect_login(source, self.app))
        self.edit(fields["email"], self.account["email"])
        fields = self.wait_for(f"{phase}-email", lambda source: inspect_login(source, self.app, self.account["email"]))
        self.edit(fields["password"], "DefinitelyWrong123" if invalid else self.password)
        fields = self.wait_for(f"{phase}-ready", lambda source: inspect_login(source, self.app, self.account["email"], True))
        self.adb("shell", "input", "tap", *center(fields["button"]))
        if invalid:
            def error_visible(source):
                nodes = parse_nodes(source, self.package)
                if not any(matches(node, "E-mail ou senha inválidos") for node in nodes):
                    raise AssertionError("API credential error is absent")
            self.wait_for(f"{phase}-rejected", error_visible)
        else:
            self.profile(f"{phase}-authenticated")

    def logout(self, phase):
        button = self.profile(f"{phase}-before")
        self.adb("shell", "input", "tap", *center(button))
        self.wait_for(phase, lambda source: inspect_login(source, self.app))

    def collect(self):
        for name, args in {
            "logcat.txt": ("logcat", "-d", "-v", "threadtime"),
            "crash.txt": ("logcat", "-b", "crash", "-d"),
            "exit-info.txt": ("shell", "dumpsys", "activity", "exit-info", self.package),
        }.items():
            try:
                source = self.adb(*args, required=False)
            except Exception:
                source = "Diagnostics unavailable"
            (self.output / name).write_text(redact(source, self.password), encoding="utf-8")
        try:
            source = self.hierarchy()
            clean = redact(source, self.password)
            (self.output / "final.xml").write_text(clean, encoding="utf-8")
            # If the app ever exposes credentials as text, omit its screenshot too.
            if clean == source:
                self.screen("final")
        except Exception:
            pass


def database_snapshot(fixture_file):
    result = subprocess.run(["pnpm", "--filter", "@predioon/api", "exec", "tsx",
                             "../../scripts/android-auth-smoke/fixture.mts", "snapshot", str(fixture_file)],
                            cwd=ROOT, capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise AssertionError("Read-only verification of isolated session metadata failed")
    return json.loads(result.stdout)


def verify_sessions(fixture_file, expected, output, phase):
    deadline = time.monotonic() + 30
    while True:
        snapshot = database_snapshot(fixture_file)
        if snapshot == {app: expected_session(state) for app, state in expected.items()}:
            (output / f"sessions-{phase}.json").write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
            return
        if time.monotonic() >= deadline:
            raise AssertionError(f"Session state did not match {phase}: {snapshot}")
        time.sleep(1)


def run(devices, apks, fixture_file, output):
    first, second = devices
    # Guard precedes every destructive operation and applies to the only selected device.
    if first.adb("shell", "getprop", "ro.kernel.qemu").strip() != "1":
        raise AssertionError("Authentication smoke requires a disposable emulator")
    if first.adb("shell", "getprop", "sys.boot_completed").strip() != "1":
        raise AssertionError("Emulator has not finished booting")
    for device in devices:
        device.adb("install", "-r", str(apks / device.app / "verification.apk"), timeout=120)
        device.adb("shell", "pm", "clear", device.package)
    first.adb("logcat", "-c")
    states = {device.app: "invalid" for device in devices}
    verify_sessions(fixture_file, states, output, "empty")
    for device in devices:
        device.launch()
        device.login("01-invalid", invalid=True)
        verify_sessions(fixture_file, states, output, f"invalid-{device.app}")
        device.adb("shell", "am", "force-stop", device.package)
    first.launch()
    first.login("02-login")
    states[first.app] = "login"
    verify_sessions(fixture_file, states, output, "first-login")
    # Both APKs are installed: the other package must still have an empty login.
    second.launch()
    second.wait_for("02-peer-isolation", lambda source: inspect_login(source, second.app))
    second.login("02-login")
    states[second.app] = "login"
    verify_sessions(fixture_file, states, output, "both-login")
    for device in devices:
        device.adb("shell", "input", "keyevent", "KEYCODE_HOME")
        device.launch()
        device.profile("03-resume")
        device.adb("shell", "am", "force-stop", device.package)
        device.launch()
        device.profile("04-restored")
        states[device.app] = "restored"
        verify_sessions(fixture_file, states, output, f"restored-{device.app}")
    first.launch()
    first.logout("05-logout")
    states[first.app] = "logout"
    verify_sessions(fixture_file, states, output, "first-logout")
    second.launch()
    second.profile("05-peer-still-authenticated")
    second.logout("05-logout")
    states[second.app] = "logout"
    verify_sessions(fixture_file, states, output, "both-logout")
    for device in devices:
        device.adb("shell", "am", "force-stop", device.package)
        device.launch()
        device.wait_for("06-logout-persisted", lambda source: inspect_login(source, device.app))
        device.login("07-relogin")
        states[device.app] = "relogin"
        verify_sessions(fixture_file, states, output, f"relogin-{device.app}")
        device.logout("08-final-logout")
        states[device.app] = "final-logout"
        verify_sessions(fixture_file, states, output, f"final-logout-{device.app}")
    for device in devices:
        device.launch()
        device.assert_no_crash()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", default="emulator-5554")
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--apks", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    args = parser.parse_args()
    password = os.environ.get("ANDROID_AUTH_PASSWORD", "")
    if len(password) < 16 or not password.isalnum():
        raise SystemExit("Expected an ephemeral alphanumeric test password with at least 16 characters")
    fixture = json.loads(args.fixture.read_text(encoding="utf-8"))
    args.artifacts.mkdir(parents=True, exist_ok=True)
    devices = []
    for app in APPS:
        folder = args.artifacts / app
        folder.mkdir(exist_ok=True)
        devices.append(AuthDevice(args.serial, app, folder, fixture, password))
    report = {"passed": False, "scope": "real isolated API login, native storage restoration and logout; no domain mutations", "apps": {device.app: device.steps for device in devices}}
    try:
        run(devices, args.apks, args.fixture.resolve(), args.artifacts)
        report["passed"] = True
    except Exception as error:
        report["error"] = redact(str(error), password)
        raise SystemExit("Authenticated Android verification failed; see sanitized result.json") from None
    finally:
        for device in devices:
            device.collect()
        (args.artifacts / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
