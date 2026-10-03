"""Verify own-password change in two coinstalled releases against an isolated real API."""
import argparse
import json
import os
from pathlib import Path
import re
import sys
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/android-auth-smoke"))
from run_auth import AuthDevice, database_snapshot, redact
from run import APPS, center, inspect_login, matches, one, parse_nodes


class SecurityViolation(RuntimeError):
    """A privacy or secure-input failure cannot be repaired by another observation."""


def sanitize(source, old_password, new_password):
    for secret in sorted([old_password, new_password, "DefinitelyWrong123"], key=len, reverse=True):
        if secret:
            source = source.replace(secret, "[redacted-password]")
    return redact(source, "")


def expected_sessions(phase):
    sessions, active, logouts = {
        "empty": (0, 0, 0), "login": (1, 1, 0), "changed": (1, 0, 0),
        "new-login": (2, 1, 0), "logout": (2, 0, 1),
    }[phase]
    return {"sessions": sessions, "active_sessions": active, "refresh_tokens": sessions,
            "rotations": 0, "logouts": logouts, "live_refresh_tokens": active}


def inspect_identity_security(source, app, fixture):
    nodes = parse_nodes(source, APPS[app][0])
    # Security is checked before eventual rendering. A missing own label must
    # never hide another account or an unprotected password input.
    for other_app, other in fixture["accounts"].items():
        if other_app != app and any(matches(node, value) for node in nodes for value in [other["email"], other["name"], other["buildingName"]]):
            raise SecurityViolation("Another product identity is visible on the password form")
    for node in nodes:
        if node.get("class") == "android.widget.EditText" and any(matches(node, label) for label in ["Senha", "Senha atual", "Nova senha", "Confirmar nova senha"]):
            if node.get("password") != "true":
                raise SecurityViolation("Password change input is not secure in Android accessibility")
    return nodes


def inspect_account(source, app, fixture):
    nodes = inspect_identity_security(source, app, fixture)
    account = fixture["accounts"][app]
    for label in [account["productTitle"], account["name"], account["email"]]:
        if not any(matches(node, label) for node in nodes):
            raise AssertionError(f"Expected own account identity is absent: {label}")
    return nodes


def inspect_own_profile(source, app, fixture):
    from run_auth import inspect_profile
    inspect_identity_security(source, app, fixture)
    return inspect_profile(source, app, fixture)


class PasswordDevice(AuthDevice):
    def __init__(self, serial, app, output, fixture, old_password, new_password):
        super().__init__(serial, app, output, fixture, old_password)
        self.new_password = new_password
        self.preflight_passed = False
        self.security_failed = False

    def clean(self, source):
        return sanitize(source, self.password, self.new_password)

    def wait_for(self, phase, inspect):
        deadline, error = time.monotonic() + 60, "Expected password journey screen did not render"
        while time.monotonic() < deadline:
            self.assert_no_crash()
            try:
                source = self.hierarchy()
                if self.clean(source) != source:
                    raise SecurityViolation("Credentials leaked into the password UI hierarchy")
                inspect_identity_security(source, self.app, self.fixture)
                result = inspect(source)
            except SecurityViolation:
                self.security_failed = True
                raise
            except (AssertionError, ET.ParseError) as cause:
                error = str(cause)
                time.sleep(1)
            else:
                (self.output / f"{phase}.xml").write_text(source, encoding="utf-8")
                self.screen(phase)
                self.steps.append({"phase": phase, "passed": True})
                return result
        raise AssertionError(f"{phase}: {error}")

    def profile(self, phase):
        return self.wait_for(phase, lambda source: inspect_own_profile(source, self.app, self.fixture))

    def login_password(self, phase, password, rejected=False):
        fields = self.wait_for(phase + "-blank", lambda source: inspect_login(source, self.app))
        self.edit(fields["email"], self.account["email"])
        fields = self.wait_for(phase + "-email", lambda source: inspect_login(source, self.app, self.account["email"]))
        self.edit(fields["password"], password.replace(" ", "%s"))
        fields = self.wait_for(phase + "-ready", lambda source: inspect_login(source, self.app, self.account["email"], True))
        self.adb("shell", "input", "tap", *center(fields["button"]))
        if rejected:
            def error_visible(source):
                nodes = parse_nodes(source, self.package)
                if not any(matches(node, "E-mail ou senha inválidos") for node in nodes):
                    raise AssertionError("Old password did not display the API credential error")
            self.wait_for(phase + "-rejected", error_visible)
        else:
            self.profile(phase + "-authenticated")

    def scroll(self, down=True):
        sizes = re.findall(r"(?:Physical|Override) size:\s*(\d+)x(\d+)", self.adb("shell", "wm", "size"))
        if not sizes:
            raise AssertionError("Android did not report a viewport")
        width, height = map(int, sizes[-1])
        start, end = (0.80, 0.38) if down else (0.38, 0.80)
        self.adb("shell", "input", "swipe", str(width // 2), str(int(height * start)), str(width // 2), str(int(height * end)), "400")

    def control(self, label, field=False):
        for attempt in range(9):
            self.assert_no_crash()
            try:
                source = self.hierarchy()
                if self.clean(source) != source:
                    raise SecurityViolation("Credentials leaked into the password UI hierarchy")
                nodes = inspect_account(source, self.app, self.fixture)
                target = one(nodes, lambda node: matches(node, label) and node.get("class") == ("android.widget.EditText" if field else "android.widget.Button") and node.get("enabled") == "true", label)
                center(target)
                return target
            except SecurityViolation:
                self.security_failed = True
                raise
            except (AssertionError, ET.ParseError):
                if attempt == 8:
                    raise
                self.scroll()
                time.sleep(0.5)

    def open_account(self, phase):
        def own_button(source):
            inspect_own_profile(source, self.app, self.fixture)
            return one(parse_nodes(source, self.package), lambda node: matches(node, "Minha conta") and node.get("class") == "android.widget.Button" and node.get("enabled") == "true", "own account button")
        button = self.wait_for(phase + "-before", own_button)
        self.adb("shell", "input", "tap", *center(button))
        def heading(source):
            nodes = inspect_account(source, self.app, self.fixture)
            if not any(matches(node, "Trocar minha senha") for node in nodes):
                raise AssertionError("Own password form is absent")
        self.wait_for(phase + "-opened", heading)
        # Each field may require scrolling. Capture only native secure and empty
        # fields, never infer cleanup from the mere presence of a page heading.
        for index, label in enumerate(["Senha atual", "Nova senha", "Confirmar nova senha"]):
            self.control(label, field=True)
            def empty_field(source, label=label):
                nodes = inspect_account(source, self.app, self.fixture)
                target = one(nodes, lambda node: matches(node, label) and node.get("class") == "android.widget.EditText", label)
                center(target)
                if target.get("text", ""):
                    raise AssertionError("Password field retained content after leaving the screen")
            self.wait_for(f"{phase}-blank-{index}", empty_field)
        for _ in range(5):
            self.scroll(False)

    def fill_password_change(self, current):
        for label, value in [("Senha atual", current), ("Nova senha", self.new_password), ("Confirmar nova senha", self.new_password)]:
            self.edit(self.control(label, field=True), value.replace(" ", "%s"))

    def submit_password_change(self, phase, incorrect=False):
        button = self.control("Confirmar troca de senha")
        self.adb("shell", "input", "tap", *center(button))
        if incorrect:
            def rejected(source):
                nodes = inspect_account(source, self.app, self.fixture)
                if not any(matches(node, "Não foi possível trocar a senha. Confira a senha atual e use uma nova senha diferente.") for node in nodes):
                    raise AssertionError("Incorrect current password did not display the form error")
            self.wait_for(phase, rejected)
        else:
            self.wait_for(phase, lambda source: inspect_login(source, self.app))

    def close_account(self, phase):
        for _ in range(5):
            self.scroll(False)
        button = self.control("Voltar ao aplicativo")
        self.adb("shell", "input", "tap", *center(button))
        self.profile(phase)

    def collect(self):
        if not self.preflight_passed or self.security_failed:
            return
        details = {"attempts": self.environment_attempts, "lastHierarchyCommand": self.last_hierarchy_output}
        (self.output / "environment-readiness.json").write_text(self.clean(json.dumps(details, ensure_ascii=False, indent=2)), encoding="utf-8")
        if self.last_adb_failure:
            (self.output / "adb-failure.json").write_text(self.clean(json.dumps(self.last_adb_failure, ensure_ascii=False)), encoding="utf-8")
        for name, args in {"logcat.txt": ("logcat", "-d", "-v", "threadtime"), "crash.txt": ("logcat", "-b", "crash", "-d"),
                           "exit-info.txt": ("shell", "dumpsys", "activity", "exit-info", self.package)}.items():
            try:
                source = self.adb(*args, required=False)
            except Exception:
                source = "Diagnostics unavailable"
            (self.output / name).write_text(self.clean(source), encoding="utf-8")
        try:
            source = self.hierarchy()
            clean = self.clean(source)
            inspect_identity_security(source, self.app, self.fixture)
            (self.output / "final.xml").write_text(clean, encoding="utf-8")
            if clean == source:
                self.screen("final")
        except Exception:
            pass


def verify(fixture_file, states, output, phase):
    deadline = time.monotonic() + 30
    while True:
        snapshot = database_snapshot(fixture_file)
        if snapshot == {app: expected_sessions(state) for app, state in states.items()}:
            (output / f"sessions-{phase}.json").write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
            return
        if time.monotonic() >= deadline:
            raise AssertionError(f"Password journey session metadata did not match {phase}: {snapshot}")
        time.sleep(1)


def run(devices, apks, fixture_file, output):
    first = devices[0]
    if first.adb("shell", "getprop", "ro.kernel.qemu").strip() != "1":
        raise AssertionError("Password journey requires a disposable emulator")
    if first.adb("shell", "getprop", "sys.boot_completed").strip() != "1":
        raise AssertionError("Emulator has not finished booting")
    states = {device.app: "empty" for device in devices}
    verify(fixture_file, states, output, "empty")
    for device in devices:
        device.preflight_passed = True
    first.wait_environment_ready()
    for device in devices:
        device.adb("install", "-r", str(apks / device.app / "verification.apk"), timeout=120)
        device.adb("shell", "pm", "clear", device.package)
    first.adb("logcat", "-c")
    for device in devices:
        device.launch()
        device.login_password("01-login", device.password)
        states[device.app] = "login"
        verify(fixture_file, states, output, "login-" + device.app)
    for device in devices:
        device.launch()
        device.open_account("02-own-account")
        device.fill_password_change("DefinitelyWrong123")
        device.submit_password_change("03-incorrect-current", incorrect=True)
        verify(fixture_file, states, output, "incorrect-preserved-" + device.app)
        device.close_account("04-back")
        device.open_account("04-cleared-account")
        device.fill_password_change(device.password)
        device.submit_password_change("05-change-confirmed")
        states[device.app] = "changed"
        verify(fixture_file, states, output, "revoked-" + device.app)
        peer = next(other for other in devices if other.app != device.app)
        peer.launch()
        if states[peer.app] == "login":
            peer.profile("05-peer-still-authenticated")
        else:
            peer.wait_for("05-peer-remains-logged-out", lambda source: inspect_login(source, peer.app))
        device.adb("shell", "am", "force-stop", device.package)
        device.launch()
        device.wait_for("06-logout-persisted", lambda source: inspect_login(source, device.app))
        device.login_password("07-old-password", device.password, rejected=True)
        verify(fixture_file, states, output, "old-rejected-" + device.app)
        device.adb("shell", "am", "force-stop", device.package)
        device.launch()
        device.login_password("08-new-literal-password", device.new_password)
        states[device.app] = "new-login"
        verify(fixture_file, states, output, "new-login-" + device.app)
        device.logout("09-final-logout")
        states[device.app] = "logout"
        verify(fixture_file, states, output, "final-logout-" + device.app)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", default="emulator-5554")
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--apks", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    args = parser.parse_args()
    old, new = os.environ.get("ANDROID_AUTH_PASSWORD", ""), os.environ.get("ANDROID_PASSWORD_NEW", "")
    if not re.fullmatch(r"[A-Za-z0-9]{16,}", old) or not re.fullmatch(r" [A-Za-z0-9 ]{15,} ", new) or old == new or len(new.encode()) > 1024:
        raise SystemExit("Expected distinct ephemeral ASCII passwords and a literal new password with surrounding spaces")
    fixture = json.loads(args.fixture.read_text(encoding="utf-8"))
    args.artifacts.mkdir(parents=True, exist_ok=True)
    devices = []
    for app in APPS:
        folder = args.artifacts / app
        folder.mkdir(exist_ok=True)
        devices.append(PasswordDevice(args.serial, app, folder, fixture, old, new))
    report = {"passed": False, "scope": "own password UI in two coinstalled Android release apps, real isolated HTTPS API and database revocation; no domain mutations", "apps": {device.app: device.steps for device in devices}}
    try:
        run(devices, args.apks, args.fixture.resolve(), args.artifacts)
        report["passed"] = True
    except Exception as cause:
        report["error"] = sanitize(str(cause), old, new)
        raise SystemExit("Android password journey failed; see sanitized result.json") from None
    finally:
        # Both products share the same selected emulator. The unaffected app's
        # collector would still inspect the screen that caused its peer to fail.
        if not any(device.security_failed for device in devices):
            for device in devices:
                if device.preflight_passed:
                    device.collect()
        (args.artifacts / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
