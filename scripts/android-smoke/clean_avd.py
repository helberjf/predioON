"""Fingerprint and verify a clean disposable AVD; never saves or restores a cache."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re

from run import Device

ROOT = Path(__file__).resolve().parents[2]
SETTINGS = {"schemaVersion": 1, "apiLevel": 35, "target": "google_apis", "abi": "x86_64", "profile": "pixel_6", "cores": 4, "ramMiB": 4096, "gpu": "swiftshader_indirect", "timezone": "Etc/UTC", "avdName": "predioon-clean"}


def properties(source):
    result = {}
    for line in source.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not key.strip() or key.strip() in result:
            raise ValueError("Invalid or duplicate Android package metadata")
        result[key.strip()] = value.strip()
    return result


def build_metadata(emulator_source, image_source, host, settings):
    emulator, image = properties(emulator_source), properties(image_source)
    for source in [emulator, image]:
        if not re.fullmatch(r"\d+(?:\.\d+)*", source.get("Pkg.Revision", "")):
            raise ValueError("Missing stable package revision")
    if emulator.get("Pkg.Path") != "emulator" or image.get("AndroidVersion.ApiLevel") != str(settings["apiLevel"]) or image.get("SystemImage.Abi") != settings["abi"] or image.get("SystemImage.TagId") != settings["target"]:
        raise ValueError("Installed packages do not match the expected AVD configuration")
    if set(host) != {"os", "arch", "image", "imageVersion", "cpu"} or not all(isinstance(value, str) and value for value in host.values()):
        raise ValueError("Incomplete runner compatibility metadata")
    if set(settings) != set(SETTINGS):
        raise ValueError("Incomplete AVD settings")
    components = {"emulator": emulator, "image": image, "host": dict(host), "settings": dict(settings)}
    encoded = json.dumps(components, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return {"cacheKey": "predioon-clean-avd-" + hashlib.sha256(encoded).hexdigest(), "components": components}


def installed_metadata(sdk):
    if platform.system() != "Linux":
        raise ValueError("This cache proposal is restricted to Linux CI runners")
    cpu_fields = {}
    for line in Path("/proc/cpuinfo").read_text().splitlines():
        key, separator, value = line.partition(":")
        if separator and key.strip() in {"vendor_id", "cpu family", "model", "model name", "stepping", "flags"}:
            cpu_fields.setdefault(key.strip(), set()).add(" ".join(value.split()))
    cpu = json.dumps({key: sorted(values) for key, values in cpu_fields.items()}, sort_keys=True)
    if not cpu_fields:
        raise ValueError("CPU compatibility information is unavailable")
    host = {"os": platform.system(), "arch": platform.machine(), "image": os.environ.get("ImageOS", ""), "imageVersion": os.environ.get("ImageVersion", ""), "cpu": cpu}
    return build_metadata((sdk / "emulator/source.properties").read_text(encoding="utf-8-sig"), (sdk / "system-images/android-35/google_apis/x86_64/source.properties").read_text(encoding="utf-8-sig"), host, SETTINGS)


def require_health(report, metadata):
    expected = {"emulator": True, "bootCompleted": True, "timezone": metadata["components"]["settings"]["timezone"], "stableObservations": 2, "productPackagesAbsent": True, "diagnosticsClean": True}
    checks = report.get("checks") if isinstance(report, dict) else None
    if not isinstance(checks, dict) or report.get("passed") is not True or report.get("cacheKey") != metadata["cacheKey"] or any(type(checks.get(key)) is not type(value) or checks.get(key) != value for key, value in expected.items()) or not isinstance(checks.get("homeComponent"), str) or not re.fullmatch(r"[A-Za-z0-9_.]+/[A-Za-z0-9_.$]+", checks["homeComponent"]):
        raise ValueError("A current complete clean-AVD health proof is required")


def check_clean_environment(device, metadata, workspace):
    # No screenshot, hierarchy or log capture is allowed until the disposable
    # environment and absence of app data have both been established.
    device.clean_diagnostics_allowed = False
    if os.environ.get("CI") != "true":
        raise ValueError("Clean AVD preparation is restricted to disposable CI")
    local = workspace / ".local"
    if os.environ.get("ANDROID_AUTH_PASSWORD") or (local.exists() and any(path.is_file() and (path.name == "fixture.json" or path.suffix in {".apk", ".key", ".jks", ".keystore"}) for path in local.rglob("*"))):
        raise ValueError("Prepare the clean AVD before creating app credentials, fixtures or APKs")
    if device.adb("shell", "getprop", "ro.kernel.qemu").strip() != "1":
        raise AssertionError("Clean snapshot preparation requires a disposable emulator")
    packages = device.adb("shell", "pm", "list", "packages", "-u", "com.predioon").strip()
    if packages:
        raise AssertionError("Product packages or retained package data are present in the AVD")
    device.clean_diagnostics_allowed = True
    if device.adb("shell", "getprop", "sys.boot_completed").strip() != "1":
        raise AssertionError("Android boot is incomplete")
    timezone = device.adb("shell", "getprop", "persist.sys.timezone").strip()
    if timezone != metadata["components"]["settings"]["timezone"] or device.adb("shell", "date", "+%z").strip() != "+0000":
        raise AssertionError("Clean AVD must use the expected UTC timezone")
    device.wait_environment_ready()
    crash = device.adb("logcat", "-b", "crash", "-d")
    log = device.adb("logcat", "-d", "-v", "threadtime")
    if crash.strip() or re.search(r"\bANR in\b|\bFatal signal\b|\bFATAL EXCEPTION\b", log):
        raise AssertionError("Android diagnostics contain crash or ANR evidence")
    attempts = device.environment_attempts[-2:]
    if len(attempts) != 2 or not all(attempt.get("ready") for attempt in attempts) or attempts[0].get("homeComponent") != attempts[1].get("homeComponent"):
        raise AssertionError("Clean AVD requires two stable current HOME observations")
    report = {"passed": True, "cacheKey": metadata["cacheKey"], "checks": {"emulator": True, "bootCompleted": True, "timezone": timezone, "homeComponent": attempts[-1]["homeComponent"], "stableObservations": 2, "productPackagesAbsent": True, "diagnosticsClean": True}}
    require_health(report, metadata)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["metadata", "check"])
    parser.add_argument("--sdk", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--serial", default="emulator-5554")
    parser.add_argument("--artifacts", type=Path)
    args = parser.parse_args()
    current = installed_metadata(args.sdk)
    if args.action == "metadata":
        args.metadata.parent.mkdir(parents=True, exist_ok=True)
        args.metadata.write_text(json.dumps(current, indent=2), encoding="utf-8")
        print(current["cacheKey"])
        return
    saved = json.loads(args.metadata.read_text(encoding="utf-8"))
    if saved != current:
        raise SystemExit("Android packages or runner changed since the cache fingerprint was computed")
    if args.artifacts is None:
        raise SystemExit("A preparation evidence directory is required")
    args.artifacts.mkdir(parents=True, exist_ok=True)
    device = Device(args.serial, "resident-mobile", args.artifacts)
    report = {"passed": False, "cacheKey": current["cacheKey"]}
    try:
        report = check_clean_environment(device, current, ROOT)
    except Exception as error:
        report["error"] = str(error)
        raise SystemExit("Clean Android preparation failed; snapshot must not be cached") from None
    finally:
        try:
            if getattr(device, "clean_diagnostics_allowed", False):
                device.collect()
        except Exception:
            report["passed"] = False
            report["error"] = "Clean environment diagnostics could not be collected"
            raise
        finally:
            (args.artifacts / "clean-health.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("Clean HOME verified; no cache operation or app installation was performed")


if __name__ == "__main__":
    main()
