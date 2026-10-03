"""Validate a clean AVD snapshot and prove restoration; never copy ADB keys or app state."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import time

from clean_avd import ROOT, Device, check_clean_environment, installed_metadata, properties, require_health


def checked_config(source, settings, sdk=None):
    # The action appends CPU/RAM even when avdmanager already wrote them. Keep
    # its explicit final value, then write each key once before starting QEMU.
    values = {}
    for line in source.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, separator, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if not separator or not key or (key in values and key not in {"hw.cpu.ncore", "hw.ramSize"}):
            raise ValueError("Invalid or ambiguous AVD configuration")
        values[key] = value
    expected = {"abi.type": settings["abi"], "hw.cpu.arch": settings["abi"], "hw.cpu.ncore": str(settings["cores"]), "hw.device.name": settings["profile"], "tag.id": settings["target"], "image.sysdir.1": f"system-images/android-{settings['apiLevel']}/{settings['target']}/{settings['abi']}/"}
    # The current SDK stores target in the AVD pointer, checked by avd_paths.
    # Older versions repeat it in config.ini; a present value must still match.
    if "target" in values:
        expected["target"] = "android-" + str(settings["apiLevel"])
    if sdk is not None:
        root = sdk.resolve(strict=True)
        image = (root / expected["image.sysdir.1"]).resolve(strict=True)
        actual = (root / values.get("image.sysdir.1", "")).resolve()
        if not image.is_relative_to(root) or actual != image:
            raise ValueError("Actual AVD configuration mismatch: image.sysdir.1")
        values["image.sysdir.1"] = expected["image.sysdir.1"]
    mismatches = [key for key, value in expected.items() if values.get(key) != value]
    if values.get("hw.ramSize") not in {str(settings["ramMiB"]), str(settings["ramMiB"]) + "M"}:
        mismatches.append("hw.ramSize")
    if mismatches:
        raise ValueError("Actual AVD configuration mismatch: " + ", ".join(mismatches))
    values["hw.ramSize"] = str(settings["ramMiB"])
    return "".join(f"{key}={value}\n" for key, value in sorted(values.items()))


def avd_paths(home, metadata):
    home = home.resolve(strict=True)
    name = metadata["components"]["settings"]["avdName"]
    if not re.fullmatch(r"[a-z0-9-]+", name):
        raise ValueError("Unexpected AVD name")
    avd, ini = home / (name + ".avd"), home / (name + ".ini")
    if avd.is_symlink() or ini.is_symlink() or not avd.is_dir() or not ini.is_file():
        raise ValueError("Expected a regular AVD directory and pointer")
    pointer = properties(ini.read_text(encoding="utf-8"))
    if Path(pointer.get("path", "")).resolve() != avd or pointer.get("target") != "android-" + str(metadata["components"]["settings"]["apiLevel"]):
        raise ValueError("AVD pointer path or target is inconsistent")
    return home, avd, ini


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(4 * 1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def inventory(home, avd, ini):
    files = {}
    for path in [ini, *sorted(avd.rglob("*"))]:
        if path.is_symlink() or not path.resolve().is_relative_to(home):
            raise ValueError("Cache contents contain an unsafe path")
        if path.is_dir():
            continue
        if not path.is_file():
            raise ValueError("Cache contents contain a non-regular file")
        files[path.relative_to(home).as_posix()] = {"bytes": path.stat().st_size, "sha256": digest(path)}
    return files


def require_boot_identity(value):
    if not isinstance(value, dict) or not re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", value.get("bootId", "")) or not re.fullmatch(r"[0-9a-f]{64}", value.get("adbPublicKeySha256", "")):
        raise ValueError("Missing guest boot or public ADB identity evidence")


def seal_snapshot(home, metadata, health):
    require_health(health, metadata)
    require_boot_identity(health)
    home, avd, ini = avd_paths(home, metadata)
    config = (avd / "config.ini").read_text(encoding="utf-8")
    checked_config(config, metadata["components"]["settings"])
    for name in ["snapshot.pb", "ram.img"]:
        snapshot = avd / "snapshots/default_boot" / name
        if not snapshot.is_file() or snapshot.stat().st_size == 0:
            raise ValueError("Completed default_boot snapshot is missing or empty")
    return {"metadata": metadata, "health": health, "files": inventory(home, avd, ini)}


def verify_snapshot(home, metadata, manifest):
    if manifest.get("metadata") != metadata:
        raise ValueError("Snapshot fingerprint differs from current SDK, runner or settings")
    current = seal_snapshot(home, metadata, manifest.get("health", {}))
    if manifest.get("files") != current["files"]:
        raise ValueError("Snapshot contents differ from the sealed clean AVD")


def require_restored_boot(current, saved):
    require_boot_identity(current)
    require_boot_identity(saved)
    if current["bootId"] != saved["bootId"]:
        raise ValueError("Guest boot ID changed: a cache hit did not restore the saved kernel")
    if current["adbPublicKeySha256"] == saved["adbPublicKeySha256"]:
        raise ValueError("Restore verification requires a fresh host ADB identity")


def qemu_running(name):
    for process in Path("/proc").iterdir():
        if not process.name.isdecimal():
            continue
        try:
            args = (process / "cmdline").read_bytes().split(b"\0")
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue
        if args and (b"qemu-system" in args[0] or Path(os.fsdecode(args[0])).name == "emulator"):
            if b"-avd" in args and args[args.index(b"-avd") + 1:][:1] == [name.encode()]:
                return True
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["configure", "boot", "seal", "verify"])
    parser.add_argument("--sdk", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--avd-home", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--restored", action="store_true")
    args = parser.parse_args()
    if os.environ.get("CI") != "true" or os.environ.get("ANDROID_AUTH_PASSWORD"):
        raise SystemExit("Snapshot verification is restricted to clean disposable CI before credentials")
    metadata = installed_metadata(args.sdk)
    if json.loads(args.metadata.read_text(encoding="utf-8")) != metadata:
        raise SystemExit("SDK/runner changed after the cache fingerprint was computed")
    _, avd, _ = avd_paths(args.avd_home, metadata)
    settings = metadata["components"]["settings"]
    if args.action == "configure":
        config = avd / "config.ini"
        source = config.read_text(encoding="utf-8")
        args.evidence.mkdir(parents=True, exist_ok=True)
        public_fields = {"abi.type", "hw.cpu.arch", "hw.cpu.ncore", "hw.device.name", "hw.ramSize", "image.sysdir.1", "tag.id", "target"}
        effective = {}
        for line in source.splitlines():
            key, separator, value = line.partition("=")
            if separator and key.strip() in public_fields:
                effective[key.strip()] = value.strip()
        (args.evidence / "avd-config.json").write_text(json.dumps(effective, indent=2), encoding="utf-8")
        config.write_text(checked_config(source, settings, args.sdk), encoding="utf-8")
        return
    if args.action == "verify":
        verify_snapshot(args.avd_home, metadata, json.loads(args.manifest.read_text(encoding="utf-8")))
        print("Exact clean snapshot inventory verified before launch")
        return
    args.evidence.mkdir(parents=True, exist_ok=True)
    health_path = args.evidence / "clean-health.json"
    if args.action == "seal":
        deadline = time.monotonic() + 60
        while qemu_running(settings["avdName"]):
            if time.monotonic() >= deadline:
                raise SystemExit("Emulator did not stop; live userdata must never be cached")
            time.sleep(0.5)
        manifest = seal_snapshot(args.avd_home, metadata, json.loads(health_path.read_text(encoding="utf-8")))
        args.manifest.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print("Stopped clean snapshot sealed; no cache save was performed by the helper")
        return
    device = Device("emulator-5554", "resident-mobile", args.evidence)
    report = {"passed": False, "cacheKey": metadata["cacheKey"]}
    try:
        report = check_clean_environment(device, metadata, ROOT)
        hardware = properties((avd / "hardware-qemu.ini").read_text(encoding="utf-8"))
        expected = {"hw.cpu.arch": settings["abi"], "hw.cpu.ncore": str(settings["cores"]), "hw.ramSize": str(settings["ramMiB"]), "hw.device.name": settings["profile"]}
        if any(hardware.get(key) != value for key, value in expected.items()) or hardware.get("hw.gpu.mode") not in {"swiftshader", "swiftshader_indirect"}:
            raise ValueError("Running QEMU hardware differs from the expected CPU, RAM, profile or renderer")
        report["hardware"] = {**expected, "hw.gpu.mode": hardware["hw.gpu.mode"]}
        report["bootId"] = device.adb("shell", "cat", "/proc/sys/kernel/random/boot_id").strip()
        # Only the public key digest is evidence. The host private key is neither
        # read by this script nor included in any cache/artifact path.
        public_key = Path(os.environ["HOME"]) / ".android/adbkey.pub"
        report["adbPublicKeySha256"] = digest(public_key)
        require_boot_identity(report)
        if args.restored:
            manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
            require_restored_boot(report, manifest["health"])
        report["snapshotRestored"] = args.restored
    except Exception as error:
        report["passed"] = False
        report["error"] = str(error)
        raise SystemExit("Clean snapshot boot failed; inspect preparation evidence") from None
    finally:
        try:
            if getattr(device, "clean_diagnostics_allowed", False):
                device.collect()
        except Exception:
            report["passed"] = False
            report["error"] = "Could not collect clean snapshot diagnostics"
            raise
        finally:
            health_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("Clean AVD boot verified" + (" with preserved kernel and fresh host ADB identity" if args.restored else ""))


if __name__ == "__main__":
    main()
