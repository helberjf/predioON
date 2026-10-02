"""ADB/UIAutomator smoke: render login, edit fields, resume, cold start, detect crashes."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET

APPS = {
    "resident-mobile": ("com.predioon.resident", "Seu condomínio, por perto."),
    "operations-mobile": ("com.predioon.operations", "A operação, em suas mãos."),
}
EMAIL = "smoke@example.invalid"
PASSWORD = "EmulatorOnly123"


def parse_nodes(source, package):
    root = ET.fromstring(source)
    blocking = next((node.get("text") for node in root.iter("node") if node.get("package") == "android" and node.get("resource-id") == "android:id/alertTitle"), None)
    if blocking:
        raise AssertionError(f"Android system dialog blocks the application: {blocking}")
    nodes = [node for node in root.iter("node") if node.get("package") == package]
    if not nodes:
        raise AssertionError("Expected application is not present in the UI hierarchy")
    return nodes


def matches(node, label):
    return node.get("content-desc") == label or node.get("text") == label


def one(nodes, predicate, description):
    found = [node for node in nodes if predicate(node)]
    if len(found) != 1:
        raise AssertionError(f"Expected one {description}, found {len(found)}")
    return found[0]


def inspect_login(source, app, email="", filled_password=False):
    package, title = APPS[app]
    nodes = parse_nodes(source, package)
    if not any(matches(node, title) for node in nodes):
        raise AssertionError("Product-specific login title is missing")
    mail = one(nodes, lambda node: node.get("class") == "android.widget.EditText" and matches(node, "E-mail"), "email field")
    password = one(nodes, lambda node: node.get("class") == "android.widget.EditText" and matches(node, "Senha"), "password field")
    button = one(nodes, lambda node: matches(node, "Entrar") and
                 (node.get("class") == "android.widget.Button" or node.get("clickable") == "true"), "login button")
    if mail.get("text", "") != email:
        raise AssertionError("Email value did not match the interaction")
    if password.get("password") != "true":
        raise AssertionError("Password field is not marked secure by Android")
    # Some Android versions omit secure text entirely. Button state below
    # confirms the typed password reached React without requiring its contents.
    if not filled_password and password.get("text", ""):
        raise AssertionError("Password was retained after a new process start")
    if PASSWORD in password.get("text", ""):
        raise AssertionError("Password is exposed in the accessibility hierarchy")
    expected_enabled = "true" if email and filled_password else "false"
    if button.get("enabled") != expected_enabled:
        raise AssertionError("Login enablement did not follow the field state")
    return {"email": mail, "password": password, "button": button}


def center(node):
    found = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.get("bounds", ""))
    if not found:
        raise AssertionError("Invalid UI node bounds")
    left, top, right, bottom = map(int, found.groups())
    if right <= left or bottom <= top:
        raise AssertionError("UI node has no visible area")
    return str((left + right) // 2), str((top + bottom) // 2)


def crash_evidence(package, crash_log, main_log, exit_info):
    if package in crash_log:
        return "Application found in Android crash buffer"
    # Native fatal signals contain process names; Java crashes include Process:.
    for line in main_log.splitlines():
        if package in line and re.search(r"ANR in|Fatal signal|Process:.*PID:", line):
            return "Application crash or ANR found in logcat"
    if re.search(r"reason=\d+\s+\((?:CRASH|CRASH_NATIVE|ANR)\)", exit_info):
        return "Android recorded a crash or ANR exit reason"
    return None


class Device:
    def __init__(self, serial, app, output):
        self.serial, self.app, self.output = serial, app, output
        self.package = APPS[app][0]
        self.steps = []
        self.last_adb_failure = None

    def adb(self, *args, binary=False, required=True, timeout=30):
        result = subprocess.run(["adb", "-s", self.serial, *args], capture_output=True, timeout=timeout)
        if required and result.returncode:
            self.last_adb_failure = {"command": list(args[:3]), "exitCode": result.returncode,
                                     "stdout": result.stdout.decode(errors="replace"), "stderr": result.stderr.decode(errors="replace")}
            raise RuntimeError(f"adb {' '.join(args[:3])} failed (exit {result.returncode}, stdout {len(result.stdout)} bytes): {result.stderr.decode(errors='replace')}")
        return result.stdout if binary else result.stdout.decode("utf-8", errors="replace")

    def hierarchy(self):
        result = self.adb("shell", "uiautomator", "dump", "/sdcard/predioon-smoke.xml", timeout=20)
        if "dumped" not in result.lower():
            raise AssertionError("UIAutomator did not produce a hierarchy")
        return self.adb("shell", "cat", "/sdcard/predioon-smoke.xml")

    def screen(self, name):
        (self.output / f"{name}.png").write_bytes(self.adb("exec-out", "screencap", "-p", binary=True))

    def assert_no_crash(self):
        # Missing diagnostics must fail verification, not look like empty clean logs.
        crash = self.adb("logcat", "-b", "crash", "-d")
        main = self.adb("logcat", "-d", "-v", "threadtime")
        exits = self.adb("shell", "dumpsys", "activity", "exit-info", self.package)
        failure = crash_evidence(self.package, crash, main, exits)
        if failure:
            raise AssertionError(failure)
        if not self.adb("shell", "pidof", self.package, required=False).strip():
            raise AssertionError("Application process stopped unexpectedly")

    def wait_login(self, phase, email="", filled_password=False):
        deadline = time.monotonic() + 60
        error = "Login did not render"
        while time.monotonic() < deadline:
            self.assert_no_crash()
            try:
                source = self.hierarchy()
                nodes = inspect_login(source, self.app, email, filled_password)
                (self.output / f"{phase}.xml").write_text(source, encoding="utf-8")
                self.screen(phase)
                self.steps.append({"phase": phase, "passed": True})
                return nodes
            except (AssertionError, ET.ParseError) as cause:
                error = str(cause)
                time.sleep(1)
        raise AssertionError(f"{phase}: {error}")

    def launch(self):
        result = self.adb("shell", "am", "start", "-W", "-n", f"{self.package}/.MainActivity")
        if not re.search(r"Status:\s*ok", result):
            raise AssertionError(f"Activity launch failed: {result}")

    def wait_environment_ready(self):
        """Require a usable HOME and diagnostics before installing the test product."""
        resolved = self.adb("shell", "cmd", "package", "resolve-activity", "--brief", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.HOME")
        components = [line.strip() for line in resolved.splitlines() if re.fullmatch(r"[A-Za-z0-9_.]+/[A-Za-z0-9_.$]+", line.strip())]
        if len(components) != 1:
            raise AssertionError("Disposable emulator has no unambiguous HOME activity")
        package = components[0].split("/")[0]
        self.adb("shell", "am", "start", "-W", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.HOME")
        deadline, stable = time.monotonic() + 90, 0
        while time.monotonic() < deadline:
            source = self.hierarchy()
            try:
                parse_nodes(source, package)
            except (AssertionError, ET.ParseError) as error:
                if "Android system dialog" in str(error):
                    raise AssertionError(f"Emulator environment failed before app installation: {error}") from None
                stable = 0
            else:
                # Success is mandatory. No retry or suppression of diagnostic errors.
                self.adb("logcat", "-d", "-v", "threadtime")
                stable += 1
                if stable == 2:
                    return
            time.sleep(1)
        raise AssertionError("Disposable emulator HOME did not become ready before app installation")

    def edit(self, node, value):
        self.adb("shell", "input", "tap", *center(node))
        time.sleep(0.5)
        # Values are fixed alphanumeric/email fixtures; no user input enters shell.
        self.adb("shell", "input", "text", value)
        time.sleep(0.5)
        self.adb("shell", "input", "keyevent", "KEYCODE_BACK")

    def collect(self):
        if self.last_adb_failure:
            (self.output / "adb-failure.json").write_text(json.dumps(self.last_adb_failure, ensure_ascii=False), encoding="utf-8")
        for name, args in {
            "logcat.txt": ("logcat", "-d", "-v", "threadtime"),
            "crash.txt": ("logcat", "-b", "crash", "-d"),
            "exit-info.txt": ("shell", "dumpsys", "activity", "exit-info", self.package),
            "activities.txt": ("shell", "dumpsys", "activity", "activities"),
        }.items():
            try:
                (self.output / name).write_text(self.adb(*args, required=False), encoding="utf-8")
            except Exception as error:
                (self.output / f"{name}.error").write_text(str(error), encoding="utf-8")
        try:
            self.screen("final")
            (self.output / "final.xml").write_text(self.hierarchy(), encoding="utf-8")
        except Exception:
            pass


def run_smoke(device, apk):
    if device.adb("shell", "getprop", "ro.kernel.qemu").strip() != "1":
        raise AssertionError("Smoke is restricted to a disposable emulator, never a physical device")
    if device.adb("shell", "getprop", "sys.boot_completed").strip() != "1":
        raise AssertionError("Emulator has not finished booting")
    device.wait_environment_ready()
    device.adb("install", "-r", str(apk), timeout=120)
    device.adb("shell", "pm", "clear", device.package)
    device.adb("logcat", "-c")
    device.launch()
    fields = device.wait_login("01-cold-login")
    device.edit(fields["email"], EMAIL)
    fields = device.wait_login("02-email-only", EMAIL)
    device.edit(fields["password"], PASSWORD)
    device.wait_login("03-ready-form", EMAIL, True)
    # Intentionally never tap Entrar: this smoke has no real authentication API.
    device.adb("shell", "input", "keyevent", "KEYCODE_HOME")
    time.sleep(2)
    device.launch()
    device.wait_login("04-resumed-form", EMAIL, True)
    device.adb("shell", "am", "force-stop", device.package)
    device.launch()
    device.wait_login("05-new-process-login")
    time.sleep(3)
    device.assert_no_crash()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", default="emulator-5554")
    parser.add_argument("--app", choices=APPS, required=True)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    args = parser.parse_args()
    args.artifacts.mkdir(parents=True, exist_ok=True)
    device = Device(args.serial, args.app, args.artifacts)
    report = {"app": args.app, "package": device.package, "passed": False, "steps": device.steps,
              "scope": "release startup and unauthenticated form lifecycle; no backend login or physical device validation"}
    try:
        run_smoke(device, args.apk)
        report["passed"] = True
    except Exception as error:
        report["error"] = str(error)
        raise
    finally:
        device.collect()
        (args.artifacts / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
