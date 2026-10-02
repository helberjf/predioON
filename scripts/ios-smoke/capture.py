"""Capture the locally signed CI build on a new, disposable iPhone simulator.

This proves launch/process survival and form text, not authenticated workflows.
Each screenshot still requires visual review before being presented as evidence.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import time
import uuid


def command(*arguments: str, timeout: int = 60, output: Path | None = None) -> str:
    result = subprocess.run(arguments, text=True, capture_output=True, timeout=timeout)
    if output is not None:
        output.write_text(result.stdout, encoding="utf-8")
    if result.returncode:
        raise RuntimeError(f"{arguments[0]} failed ({result.returncode}): {result.stderr[-2000:]}")
    return result.stdout.strip()


def iphone_target(inventory: dict, sdk_version: str) -> tuple[str, str]:
    """Use a device/runtime combination that the installed Xcode already lists."""
    def version(value):
        parts = tuple(int(part) for part in value.split("."))
        return parts + (0,) * (3 - len(parts))
    runtimes = sorted(
        (item for item in inventory["runtimes"]
         if item.get("isAvailable") and item["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS-")
         and version(item["version"]) <= version(sdk_version)),
        key=lambda item: version(item["version"]),
        reverse=True,
    )
    types = {item["name"]: item["identifier"] for item in inventory["devicetypes"]}
    for runtime in runtimes:
        for device in inventory["devices"].get(runtime["identifier"], []):
            if device.get("isAvailable") and device["name"].startswith("iPhone"):
                device_type = device.get("deviceTypeIdentifier") or types.get(device["name"])
                if device_type:
                    return runtime["identifier"], device_type
    raise RuntimeError("No available iPhone/iOS runtime compatible with the selected Xcode SDK")


def simulator_product(info: dict) -> str:
    if info.get("CFBundleSupportedPlatforms") != ["iPhoneSimulator"]:
        raise RuntimeError("CI capture requires an iPhoneSimulator build")
    bundle = info.get("CFBundleIdentifier")
    if bundle not in {"com.predioon.resident", "com.predioon.operations"}:
        raise RuntimeError("Unexpected application bundle")
    return bundle


def capture(application: Path, destination: Path) -> None:
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise RuntimeError("This command manages only disposable GitHub macOS runner simulators")
    application = application.resolve(strict=True)
    destination.mkdir(parents=True, exist_ok=True)
    destination = destination.resolve()
    with (application / "Info.plist").open("rb") as source:
        info = plistlib.load(source)
    bundle = simulator_product(info)
    executable = info["CFBundleExecutable"]
    binary = application / executable
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise RuntimeError("Application executable missing or not executable")
    evidence = {
        "commit": os.environ.get("GITHUB_SHA"), "bundleId": bundle,
        "binarySha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
        "passed": False, "scope": "launch, process survival, relaunch and login-form OCR; no authenticated requests",
        "phases": [], "screenshots": [],
    }
    device_id = None
    try:
        # Xcode embeds the simulated iOS entitlements in Mach-O sections. Putting
        # them in a replacement macOS code signature can make the host refuse
        # to launch. Validate the Xcode product without re-signing its binary.
        command("codesign", "--verify", "--strict", str(application))
        sections = command("xcrun", "otool", "-l", str(binary))
        if not re.search(r"sectname\s+__entitlements\b", sections):
            raise RuntimeError("Xcode simulator binary has no embedded entitlement section")
        evidence.update(signing="Xcode local simulator signature; not a distribution signature",
                        embeddedEntitlementSection=True)
        evidence["phases"].append("simulator-signature-verified")
        sdk_version = command("xcrun", "--sdk", "iphonesimulator", "--show-sdk-version")
        inventory = json.loads(command("xcrun", "simctl", "list", "--json"))
        runtime, device_type = iphone_target(inventory, sdk_version)
        evidence.update(runtime=runtime, deviceType=device_type, sdkVersion=sdk_version,
                        xcode=command("xcodebuild", "-version"), apiOrigin="https://smoke-api.invalid")
        created = command("xcrun", "simctl", "create", f"PredioON-capture-{uuid.uuid4()}", device_type, runtime)
        device_id = str(uuid.UUID(created))
        command("xcrun", "simctl", "bootstatus", device_id, "-b", timeout=180)
        evidence["phases"].append("simulator-booted")
        command("xcrun", "simctl", "install", device_id, str(application), timeout=120)
        evidence["phases"].append("release-installed")
        previous_pid = None
        for phase in ("01-first-launch", "02-new-process"):
            launched = command("xcrun", "simctl", "launch", device_id, bundle,
                               "-AppleLanguages", "(pt-BR)", "-AppleLocale", "pt_BR")
            match = re.fullmatch(re.escape(bundle) + r":\s*(\d+)", launched)
            if not match:
                raise RuntimeError("simctl did not return the application PID")
            pid = match.group(1)
            if pid == previous_pid:
                raise RuntimeError("Relaunch reused the terminated process")
            for _ in range(3):
                time.sleep(5)
                running = command("ps", "-p", pid, "-o", "comm=")
                if Path(running).name != executable:
                    raise RuntimeError("Application process did not survive launch")
            screenshot = destination / f"{phase}.png"
            command("xcrun", "simctl", "io", device_id, "screenshot", "--type=png", str(screenshot))
            contents = screenshot.read_bytes()
            if not contents.startswith(b"\x89PNG\r\n\x1a\n") or len(contents) < 1024:
                raise RuntimeError("Simulator did not produce a PNG screenshot")
            command("swift", str(Path(__file__).with_name("inspect.swift")), str(screenshot), bundle,
                    timeout=120, output=destination / f"{phase}.ocr.json")
            evidence["screenshots"].append({"file": screenshot.name,
                                           "sha256": hashlib.sha256(contents).hexdigest()})
            evidence["phases"].append(phase)
            command("xcrun", "simctl", "terminate", device_id, bundle)
            previous_pid = pid
        evidence["passed"] = True
    except Exception as error:
        evidence["error"] = str(error)
        raise
    finally:
        if device_id:
            try:
                logs = command("xcrun", "simctl", "spawn", device_id, "log", "show", "--style", "compact",
                               "--last", "3m", "--predicate",
                               f'process == "{executable}" OR eventMessage CONTAINS "{bundle}"')
                (destination / "application.log").write_text(logs, encoding="utf-8")
                if not evidence["passed"]:
                    command("log", "show", "--style", "compact", "--last", "3m", "--predicate",
                            f'eventMessage CONTAINS "{bundle}" OR eventMessage CONTAINS "{executable}"',
                            output=destination / "host-launch.log")
            except Exception as error:
                evidence["diagnosticError"] = str(error)
            cleanup_errors = []
            for action in ("shutdown", "delete"):
                try:
                    command("xcrun", "simctl", action, device_id)
                except Exception as error:
                    cleanup_errors.append(str(error))
            if cleanup_errors:
                evidence["cleanupErrors"] = cleanup_errors
                evidence["passed"] = False
        (destination / "result.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
        if evidence.get("cleanupErrors"):
            raise RuntimeError("Disposable simulator cleanup failed; inspect result.json")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    capture(arguments.application, arguments.output)
