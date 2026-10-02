"""Observe actual resident UI, reserved intervals, explicit writes and calendar revocation."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import time

from reservation_assertions import ROOT, PrivacyViolation, CALENDAR_END, inspect_calendar, inspect_confirmation, assert_snapshot
from run_domains import DomainDevice
from run_auth import redact, center, matches


class ReservationDevice(DomainDevice):
    def find_label(self, label):
        for attempt in range(9):
            nodes = self.nodes()
            targets = [node for node in nodes if matches(node, label)]
            for target in targets:
                try:
                    center(target)
                    return target
                except AssertionError:
                    pass
            if attempt == 8:
                raise AssertionError("Reservation label is not visible: " + label)
            self.scroll()

    def calendar(self, phase, state):
        self.find_label("Horários ocupados")
        self.find_label(CALENDAR_END)
        def inspect(source):
            try:
                return inspect_calendar(source, self.package, self.account["buildingName"], state, self.forbidden_labels())
            except PrivacyViolation as error:
                raise RuntimeError(str(error)) from None
        self.wait_for(phase, inspect)

    def date(self):
        # A new form is empty; refuse accidental append/retype of an existing date.
        target = self.find("Data (AAAA-MM-DD)", field=True)
        if target.get("text", "") not in {"", "2026-12-20"}:
            raise AssertionError("Expected an empty date field before fixture input")
        self.edit(target, self.fixture["date"])
        actual = self.find("Data (AAAA-MM-DD)", field=True)
        if actual.get("text") != self.fixture["date"]:
            raise AssertionError("Reservation date does not match the entered fixture")

    def choose(self, kind, new_date=False):
        self.top()
        self.tap(self.fixture["labels"][kind + "Area"])
        if new_date:
            self.date()

    def confirmation(self, phase, choice):
        controls = self.wait_for(phase, lambda source: inspect_confirmation(source, self.package))
        self.adb("shell", "input", "tap", *center(controls[choice]))


def fixture_action(filename, action):
    result = subprocess.run(["pnpm", "--filter", "@predioon/api", "exec", "tsx", "../../scripts/android-reservation-smoke/fixture.mts", action, str(filename)], cwd=ROOT, capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise RuntimeError("Isolated reservation fixture command failed: " + action)
    return json.loads(result.stdout) if action == "snapshot" else None


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


def run(device, apk, filename, output):
    if device.adb("shell", "getprop", "ro.kernel.qemu").strip() != "1":
        raise AssertionError("Reservation verification requires a disposable emulator")
    if device.adb("shell", "getprop", "sys.boot_completed").strip() != "1":
        raise AssertionError("Emulator has not completed boot")
    zone = device.adb("shell", "getprop", "persist.sys.timezone").strip()
    offset = device.adb("shell", "date", "+%z").strip()
    if zone not in {"Etc/UTC", "UTC"} or offset != "+0000":
        raise AssertionError("Reservation verification requires the explicitly configured UTC emulator")
    (output / "timezone.json").write_text(json.dumps({"zone": zone, "offset": offset, "fixtureDate": device.fixture["date"], "buildingTimezone": "UTC"}), encoding="utf-8")
    device.wait_environment_ready()
    device.adb("install", "-r", str(apk), timeout=120)
    device.adb("shell", "pm", "clear", device.package)
    device.adb("logcat", "-c")
    prove(filename, output, "initial")
    device.launch()
    device.login("01-login")
    device.enter_building("02-enter")
    device.tap("Reservas")
    device.wait_domain("03-reservations", ["Reservar um espaço"])
    device.choose("auto", new_date=True)
    device.calendar("04-occupied-private", "occupied")
    device.choose("pending")
    device.calendar("05-other-area-empty", "empty")
    device.choose("auto")
    device.calendar("06-original-area-occupied", "occupied")
    device.tap("Solicitar reserva")
    device.top()
    device.wait_domain("07-conflict", ["Já existe uma reserva para esta área neste horário"])
    prove(filename, output, "conflict")
    # A separate actor changes the fixture; no API command substitutes a UI action.
    fixture_action(filename, "cancel-neighbor")
    prove(filename, output, "released")
    device.tap("Atualizar horários")
    device.calendar("08-neighbor-released", "empty")
    device.tap("Solicitar reserva")
    device.top()
    device.wait_domain("09-confirmed", ["Reserva confirmada.", "Confirmada"])
    prove(filename, output, "confirmed")
    device.tap("Cancelar reserva")
    device.confirmation("10-cancel-dialog-back", "back")
    device.wait_domain("11-back-keeps-reservation", ["Confirmada"])
    prove(filename, output, "back")
    device.tap("Cancelar reserva")
    device.confirmation("12-cancel-dialog-confirm", "confirm")
    device.top()
    device.wait_domain("13-cancelled", ["Reserva cancelada.", "Cancelado"])
    prove(filename, output, "cancelled")
    device.choose("auto", new_date=True)
    device.calendar("14-own-cancel-releases-interval", "empty")
    device.choose("pending")
    device.calendar("15-approval-area-empty", "empty")
    device.tap("Solicitar reserva")
    device.top()
    device.wait_domain("16-pending", ["Reserva enviada para aprovação.", "Aguardando aprovação"], ["Confirmada"])
    prove(filename, output, "pending")
    device.choose("auto", new_date=True)
    device.calendar("17-before-revocation", "empty")
    fixture_action(filename, "revoke-calendar")
    device.resume()
    # Background revalidation can unmount the form. Select the current area and
    # enter a fresh date only if the new form is empty; never repeat a write.
    device.top()
    device.tap(device.fixture["labels"]["autoArea"])
    current = device.find("Data (AAAA-MM-DD)", field=True).get("text", "")
    if current in {"", "2026-12-20"}:
        device.date()
    elif current != device.fixture["date"]:
        raise AssertionError("Date changed unexpectedly after resume")
    device.calendar("18-calendar-revoked", "denied")
    prove(filename, output, "revoked")
    device.top()
    device.exit_building("19-logout")
    device.assert_no_crash()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", default="emulator-5554")
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    args = parser.parse_args()
    password = os.environ.get("ANDROID_AUTH_PASSWORD", "")
    if not re.fullmatch(r"[A-Za-z0-9]{16,}", password):
        raise SystemExit("Expected ephemeral alphanumeric credentials")
    fixture = json.loads(args.fixture.read_text(encoding="utf-8"))
    args.artifacts.mkdir(parents=True, exist_ok=True)
    directory = args.artifacts / "resident-mobile"
    directory.mkdir(exist_ok=True)
    device = ReservationDevice(args.serial, "resident-mobile", directory, fixture, password)
    report = {"passed": False, "scope": "resident private occupancy, conflict, own create/cancel, pending approval and calendar revocation; no management or physical commands", "steps": device.steps}
    try:
        run(device, args.apk, args.fixture.resolve(), args.artifacts)
        report["passed"] = True
    except Exception as error:
        report["error"] = redact(str(error), password)
        raise SystemExit("Native reservation verification failed; inspect sanitized evidence") from None
    finally:
        device.collect()
        (args.artifacts / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
