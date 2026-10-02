"""Prepare an isolated release build for emulator verification; no production keys."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
APPS = {"resident-mobile": "com.predioon.resident", "operations-mobile": "com.predioon.operations"}
SMOKE_ORIGIN = "https://smoke-api.invalid"
AUTH_ORIGIN = "https://10.0.2.2:3443"
ORIGINS = {"startup": SMOKE_ORIGIN, "auth": AUTH_ORIGIN}


def configure_source(source, origin=SMOKE_ORIGIN):
    if origin not in ORIGINS.values():
        raise ValueError("Only the fixed verification origins are supported")
    pattern = r'const PRODUCTION_API_URL = "[^"\r\n]*";'
    if len(re.findall(pattern, source)) != 1:
        raise ValueError("Expected exactly one literal PRODUCTION_API_URL; review the smoke adapter")
    return re.sub(pattern, f'const PRODUCTION_API_URL = "{origin}";', source)


def validate_badging(badging, package):
    if not re.search(r"^package: name='" + re.escape(package) + r"'", badging, re.M):
        raise ValueError("APK package does not match the selected product")
    if "application-debuggable" in badging:
        raise ValueError("Smoke requires a release APK with bundled JavaScript")
    if not re.search(r"^native-code:.*'x86_64'", badging, re.M):
        raise ValueError("APK must include x86_64 native libraries for this emulator")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["configure", "sign"])
    parser.add_argument("--app", choices=APPS, required=True)
    parser.add_argument("--scenario", choices=ORIGINS, default="startup")
    parser.add_argument("--apk", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.action == "configure":
        if os.environ.get("CI") != "true":
            raise SystemExit("Configuration adapter is restricted to the disposable CI checkout")
        config = ROOT / "apps" / args.app / "config.ts"
        config.write_text(configure_source(config.read_text(encoding="utf-8"), ORIGINS[args.scenario]), encoding="utf-8")
        print(f"Smoke checkout configured for {args.app}; scenario {args.scenario}")
        return
    if not args.apk or not args.output:
        parser.error("sign requires --apk and --output")
    sdk = Path(os.environ["ANDROID_HOME"])
    versions = [item for item in (sdk / "build-tools").iterdir() if re.fullmatch(r"\d+\.\d+\.\d+", item.name)]
    build_tools = max(versions, key=lambda item: tuple(map(int, item.name.split("."))))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="predioon-smoke-sign-") as temporary:
        key = str(Path(temporary) / "verification.p12")
        subprocess.run(["keytool", "-genkeypair", "-noprompt", "-keystore", key,
                        "-storetype", "PKCS12", "-alias", "smoke", "-storepass", "android",
                        "-keypass", "android", "-keyalg", "RSA", "-keysize", "2048",
                        "-validity", "1", "-dname", "CN=Predio ON disposable emulator verification"], check=True, timeout=60)
        subprocess.run([str(build_tools / "apksigner"), "sign", "--ks", key,
                        "--ks-pass", "pass:android", "--key-pass", "pass:android",
                        "--out", str(args.output), str(args.apk)], check=True, timeout=60)
    signature = subprocess.check_output([str(build_tools / "apksigner"), "verify", "--verbose", str(args.output)], text=True)
    badging = subprocess.check_output([str(build_tools / "aapt2"), "dump", "badging", str(args.output)], text=True)
    validate_badging(badging, APPS[args.app])
    metadata = {"app": args.app, "package": APPS[args.app], "gitSha": os.environ.get("GITHUB_SHA"),
                "architecture": "x86_64", "mode": "release", "apiOrigin": ORIGINS[args.scenario],
                "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest(),
                "signing": "ephemeral one-day CI key; not a store signing identity",
                "signatureVerification": signature}
    (args.output.parent / "build.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
