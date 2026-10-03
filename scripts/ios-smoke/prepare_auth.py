"""Configure only a disposable GitHub macOS checkout and private runner files."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import secrets
import sys

ROOT = Path(__file__).resolve().parents[2]
APPS = {"resident-mobile": "com.predioon.resident", "operations-mobile": "com.predioon.operations"}
ORIGIN = "https://127.0.0.1:3443"


def configure_source(source):
    pattern = r'const PRODUCTION_API_URL = "[^"\r\n]*";'
    if len(re.findall(pattern, source)) != 1:
        raise ValueError("Expected exactly one production origin literal")
    return re.sub(pattern, f'const PRODUCTION_API_URL = "{ORIGIN}";', source)


def disposable_path(path, environment=None):
    environment = os.environ if environment is None else environment
    if environment.get("GITHUB_ACTIONS") != "true" or environment.get("RUNNER_OS") != "macOS":
        raise ValueError("Authenticated iOS verification requires the disposable GitHub macOS runner")
    temporary = Path(environment.get("RUNNER_TEMP", "/missing-runner-temp")).resolve(strict=True)
    path = Path(path).resolve()
    if path == temporary or temporary not in path.parents or path.is_symlink():
        raise ValueError("Private verification files must stay below RUNNER_TEMP")
    return path


def prepare(directory):
    directory = disposable_path(directory)
    if directory.exists():
        raise ValueError("Private verification directory must be new")
    changes = [(ROOT / "apps" / app / "config.ts") for app in APPS]
    updated = [configure_source(path.read_text(encoding="utf-8")) for path in changes]
    directory.mkdir(mode=0o700)
    sys.path.insert(0, str(ROOT / "scripts/android-auth-smoke"))
    from tls import create_certificates
    create_certificates(directory / "tls")  # SAN already includes 127.0.0.1; no host trust change.
    old = secrets.token_hex(18)
    new = " New " + secrets.token_hex(18) + " phrase "
    token = secrets.token_hex(32)
    for secret in [old, new, token]:
        print("::add-mask::" + secret)
    environment = {"ANDROID_AUTH_PASSWORD": old, "ANDROID_PASSWORD_NEW": new, "IOS_AUTH_COORDINATOR_TOKEN": token}
    (directory / "secrets.json").write_text(json.dumps(environment), encoding="utf-8")
    (directory / "secrets.json").chmod(0o600)
    with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as destination:
        for key, value in environment.items():
            destination.write(f"{key}={value}\n")
        destination.write(f"IOS_AUTH_PRIVATE={directory}\n")
    for path, source in zip(changes, updated):
        path.write_text(source, encoding="utf-8")
    print("Both disposable simulator releases configured for the fixed local HTTPS API")


def runner_configuration(directory, fixture):
    directory = disposable_path(directory)
    fixture = json.loads(Path(fixture).read_text(encoding="utf-8"))
    credentials = json.loads((directory / "secrets.json").read_text(encoding="utf-8"))
    if sorted(fixture.get("accounts", {})) != sorted(APPS):
        raise ValueError("Expected exactly the two isolated fixture accounts")
    configuration = {"accounts": fixture["accounts"], "oldPassword": credentials["ANDROID_AUTH_PASSWORD"],
                     "newPassword": credentials["ANDROID_PASSWORD_NEW"], "token": credentials["IOS_AUTH_COORDINATOR_TOKEN"]}
    encoded = base64.b64encode(json.dumps(configuration, ensure_ascii=False).encode()).decode()
    # Generated outside the repository, never uploaded or printed. Base64 is
    # transport encoding, not redaction; the generated source remains private.
    (directory / "AuthConfiguration.swift").write_text(
        'import Foundation\nenum AuthConfiguration {\n'
        f'  static let encoded = "{encoded}"\n}}\n', encoding="utf-8")
    (directory / "AuthConfiguration.swift").chmod(0o600)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "runner"])
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--fixture", type=Path)
    arguments = parser.parse_args()
    if arguments.action == "prepare":
        prepare(arguments.directory)
    elif not arguments.fixture:
        parser.error("runner requires --fixture")
    else:
        runner_configuration(arguments.directory, arguments.fixture)
