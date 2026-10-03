"""Interact with actual native domain UI and verify changes in the isolated real database."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

from assertions import ROOT, PrivacyViolation, action_node, assert_snapshot, inspect_domain
sys.path.insert(0, str(ROOT / "scripts/android-auth-smoke"))
from run_auth import APPS, AuthDevice, center, inspect_login, matches, one, redact

TABS = {"resident-mobile": ["Avisos", "Solicitações", "Transparência"],
        "operations-mobile": ["Resumo", "Alertas", "Sensores", "Solicitações"]}


class DomainDevice(AuthDevice):
    def forbidden_labels(self):
        return self.fixture["forbidden"] + [value for app, account in self.fixture["accounts"].items()
            if app != self.app for key, value in account.items() if key in {"name", "email", "buildingName", "productTitle"}]

    def wait_domain(self, phase, required=(), forbidden=()):
        def inspect(source):
            try:
                return inspect_domain(source, self.package, self.account["buildingName"], required,
                                      self.forbidden_labels() + list(forbidden))
            except PrivacyViolation as error:
                # A privacy failure is terminal, not an eventually consistent view.
                raise RuntimeError(str(error)) from None
        return self.wait_for(phase, inspect)

    def nodes(self):
        self.assert_no_crash()
        source = self.hierarchy()
        if redact(source, self.password) != source:
            raise RuntimeError("Credentials leaked into the UI hierarchy")
        return inspect_domain(source, self.package, self.account["buildingName"], (), self.forbidden_labels())

    def wait_statement(self, phase, title):
        # Keep the existing nine observations/eight scrolls. A static heading
        # is not evidence that the asynchronous published report has rendered.
        for attempt in range(9):
            self.assert_no_crash()
            try:
                source = self.hierarchy()
                if redact(source, self.password) != source:
                    raise RuntimeError("Credentials leaked into the UI hierarchy")
                nodes = inspect_domain(source, self.package, self.account["buildingName"], (), self.forbidden_labels())
                report = one(nodes, lambda n: n.get("class") == "android.widget.TextView" and n.get("text") == title, "published statement " + title)
                center(report)
                action_node(nodes, "Ver lançamentos (1)")
            except PrivacyViolation:
                raise
            except (AssertionError, ET.ParseError):
                if attempt == 8:
                    raise
                self.scroll()
                time.sleep(0.5)
            else:
                self.screen(phase)
                (self.output / f"{phase}.xml").write_text(source, encoding="utf-8")
                self.steps.append({"phase": phase, "passed": True})
                return

    def viewport(self):
        result = self.adb("shell", "wm", "size")
        sizes = re.findall(r"(?:Physical|Override) size:\s*(\d+)x(\d+)", result)
        if not sizes:
            raise AssertionError("Android did not report a viewport")
        return tuple(map(int, sizes[-1]))

    def scroll(self, down=True):
        width, height = self.viewport()
        start, end = (0.80, 0.38) if down else (0.38, 0.80)
        self.adb("shell", "input", "swipe", str(width // 2), str(int(height * start)), str(width // 2), str(int(height * end)), "400")

    def top(self):
        for _ in range(5):
            self.scroll(False)

    def find(self, label, field=False):
        for attempt in range(9):
            nodes = self.nodes()
            try:
                if field:
                    target = one(nodes, lambda n: matches(n, label) and n.get("class") == "android.widget.EditText" and n.get("enabled") == "true", label)
                    center(target)  # Scroll an offscreen field before returning it for input.
                    return target
                return action_node(nodes, label)
            except AssertionError:
                if attempt == 8:
                    raise
                self.scroll()
                time.sleep(0.5)

    def tap(self, label):
        target = self.find(label)
        # Exactly one user action. No POST/gesture replay on a slow response.
        self.adb("shell", "input", "tap", *center(target))

    def find_text(self, label):
        for attempt in range(9):
            nodes = self.nodes()
            try:
                target = one(nodes, lambda n: n.get("class") == "android.widget.TextView" and n.get("text") == label, "visible text " + label)
                center(target)
                return target
            except AssertionError:
                if attempt == 8:
                    raise
                self.scroll()
                time.sleep(0.5)

    def send_comment(self, phase, text):
        self.fill("Nova mensagem", text)
        self.tap("Enviar mensagem")
        # Wait for the result of that one submission before searching further
        # down the conversation; slow API responses must never trigger a resend.
        self.wait_domain(phase + "-sent", ["Mensagem enviada."])
        self.top()
        self.find_text(text)
        self.wait_domain(phase, [text])

    def tab(self, label):
        order = TABS[self.app]
        for attempt in range(4):
            nodes = self.nodes()
            try:
                target = action_node(nodes, label)
            except AssertionError:
                candidates = [n for n in nodes if n.get("class") == "android.widget.Button" and any(matches(n, tab) for tab in order)]
                if not candidates or attempt == 3:
                    raise
                _, y = center(candidates[0])
                width, _ = self.viewport()
                visible = [order.index(tab) for tab in order if any(matches(n, tab) for n in candidates)]
                start, end = (0.12, 0.88) if order.index(label) < min(visible) else (0.88, 0.12)
                self.adb("shell", "input", "swipe", str(int(width * start)), y, str(int(width * end)), y, "400")
            else:
                self.adb("shell", "input", "tap", *center(target))
                return

    def fill(self, label, value):
        if not re.fullmatch(r"[A-Za-z0-9 ]+", value):
            raise AssertionError("Domain input must be an ASCII fixture, never shell input")
        self.edit(self.find(label, field=True), value.replace(" ", "%s"))

    def enter_building(self, phase):
        self.profile(phase + "-profile")
        nodes = self.hierarchy()
        from run import parse_nodes
        button = action_node(parse_nodes(nodes, self.package), "Acessar condomínio")
        self.adb("shell", "input", "tap", *center(button))
        self.wait_domain(phase + "-building", ["Trocar"])

    def resume(self):
        self.adb("shell", "input", "keyevent", "KEYCODE_HOME")
        self.launch()

    def exit_building(self, phase):
        # A revoked account may no longer have a building in the picker. The
        # persistent profile header still exposes logout from the current screen.
        self.tap("Sair")
        self.wait_for(phase, lambda source: inspect_login(source, self.app))


def fixture_action(filename, action, kind=None):
    command = ["pnpm", "--filter", "@predioon/api", "exec", "tsx", "../../scripts/android-domain-smoke/fixture.mts", action, str(filename)]
    if kind:
        command.append(kind)
    response = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=30)
    if response.returncode:
        raise RuntimeError("Isolated domain fixture command failed: " + action)
    return json.loads(response.stdout) if action == "snapshot" else None


def prove(filename, output, phase):
    deadline = time.monotonic() + 30
    while True:
        snapshot = fixture_action(filename, "snapshot")
        try:
            assert_snapshot(snapshot, phase)
        except AssertionError:
            if time.monotonic() >= deadline:
                (output / f"database-{phase}-failed.json").write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
                raise
            time.sleep(1)
        else:
            (output / f"database-{phase}.json").write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
            return


def run(devices, apks, fixture_file, output):
    resident, operator = devices
    labels = resident.fixture["labels"]
    if resident.adb("shell", "getprop", "ro.kernel.qemu").strip() != "1":
        raise AssertionError("Domain verification requires a disposable emulator")
    if resident.adb("shell", "getprop", "sys.boot_completed").strip() != "1":
        raise AssertionError("Emulator has not finished booting")
    resident.wait_environment_ready()
    for device in devices:
        device.adb("install", "-r", str(apks / device.app / "verification.apk"), timeout=120)
        device.adb("shell", "pm", "clear", device.package)
    resident.adb("logcat", "-c")
    prove(fixture_file, output, "initial")

    resident.launch()
    resident.login("01-login")
    resident.enter_building("02-enter")
    resident.wait_domain("03-notices", [labels["notice"]])
    resident.tab("Transparência")
    resident.wait_statement("04-finance", labels["report"])
    resident.tap("Ver lançamentos (1)")
    # The expanded entry can be below the fold; scroll only until it is visible.
    resident.scroll()
    resident.wait_domain("05-finance-entry", [labels["entry"]])
    resident.top()
    resident.tab("Solicitações")
    resident.wait_domain("06-own-ticket", [labels["ownTicket"]])
    resident.tap("Nova solicitação")
    resident.fill("Título", labels["created"])
    resident.fill("Descrição", labels["description"])
    resident.tap("Enviar solicitação")
    resident.wait_domain("07-created", [labels["created"]])
    resident.send_comment("08-comment", labels["comment"])
    prove(fixture_file, output, "resident")

    operator.launch()
    operator.login("01-login")
    operator.enter_building("02-enter")
    operator.wait_domain("03-summary", ["Chamados em aberto", "Somente chamados concedidos ao seu perfil."])
    operator.tab("Sensores")
    operator.wait_domain("04-sensor", [labels["device"], "42 %"])
    operator.tab("Alertas")
    operator.wait_domain("05-alert", [labels["alert"]])
    operator.tap("Ver ações deste alerta")
    operator.tap("Reconhecer")
    operator.wait_domain("06-acknowledged", ["Alerta reconhecido."])
    operator.tab("Solicitações")
    operator.wait_domain("07-ticket", [labels["operatorTicket"]], ["Nova solicitação"])
    operator.tap("Acompanhar conversa")
    operator.wait_domain("08-conversation", [labels["operatorTicket"]])
    operator.tap("Iniciar")
    operator.wait_domain("09-in-progress", ["Em execução"])
    operator.send_comment("10-comment", labels["operatorComment"])
    prove(fixture_file, output, "actions")

    operator.tab("Sensores")
    operator.wait_domain("11-before-device-revoke", [labels["device"]])
    fixture_action(fixture_file, "revoke", "device")
    operator.resume()
    operator.wait_domain("12-device-revoked", ["Somente chamados concedidos ao seu perfil."], [labels["device"], labels["alert"], "Sensores", "Alertas"])
    prove(fixture_file, output, "device-revoked")
    operator.tab("Solicitações")
    operator.tap("Acompanhar conversa")
    operator.wait_domain("13-before-ticket-revoke", [labels["operatorTicket"]])
    fixture_action(fixture_file, "revoke", "ticket")
    operator.resume()
    operator.wait_domain("14-ticket-revoked", ["Prédio fora do seu escopo"], [labels["operatorTicket"], "Concluir", "Nova mensagem"])

    resident.launch()
    resident.tab("Transparência")
    resident.wait_domain("09-before-finance-revoke", ["Prestação de contas"])
    fixture_action(fixture_file, "revoke", "finance")
    resident.resume()
    resident.wait_domain("10-finance-revoked", ["Informes da gestão"], ["Prestação de contas", labels["report"], labels["entry"]])
    prove(fixture_file, output, "final")
    for device in devices:
        device.launch()
        device.exit_building("15-logout")
        device.assert_no_crash()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", default="emulator-5554")
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--apks", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    args = parser.parse_args()
    password = os.environ.get("ANDROID_AUTH_PASSWORD", "")
    if not re.fullmatch(r"[A-Za-z0-9]{16,}", password):
        raise SystemExit("Expected an ephemeral alphanumeric password")
    fixture = json.loads(args.fixture.read_text(encoding="utf-8"))
    args.artifacts.mkdir(parents=True, exist_ok=True)
    devices = []
    for app in APPS:
        directory = args.artifacts / app
        directory.mkdir(exist_ok=True)
        devices.append(DomainDevice(args.serial, app, directory, fixture, password))
    report = {"passed": False, "scope": "real native notices, published finance, own tickets, exact operations and revocation; no physical commands",
              "apps": {device.app: device.steps for device in devices}}
    try:
        run(devices, args.apks, args.fixture.resolve(), args.artifacts)
        report["passed"] = True
    except Exception as error:
        report["error"] = redact(str(error), password)
        raise SystemExit("Native domain verification failed; inspect sanitized evidence") from None
    finally:
        for device in devices:
            device.collect()
        (args.artifacts / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
