"""Configure only a disposable GitHub macOS checkout and private runner files."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
APPS = {"resident-mobile": "com.predioon.resident", "operations-mobile": "com.predioon.operations"}
ORIGIN = "https://127.0.0.1:3443"


def choose_openssl(binary):
    """An explicit OpenSSL3 binary, never a fallback through PATH."""
    if not isinstance(binary, (str, Path)) or not Path(binary).is_absolute():
        raise ValueError("TLS requires an explicit absolute OpenSSL3 executable")
    try:
        selected = Path(binary).resolve(strict=True)
    except OSError:
        raise ValueError("The explicit OpenSSL3 executable does not exist") from None
    if not selected.is_file() or not os.access(selected, os.X_OK):
        raise ValueError("The explicit OpenSSL3 path is not executable")
    def probe(*arguments):
        try:
            result = subprocess.run([str(selected), *arguments], capture_output=True, text=True, timeout=30)
        except (OSError, subprocess.TimeoutExpired):
            raise RuntimeError("The explicit OpenSSL3 probe failed or timed out") from None
        if result.returncode:
            code = result.returncode if 0 <= result.returncode <= 255 else "unknown"
            raise RuntimeError(f"TLS OpenSSL3 probe failed: stage={arguments[0]}, exit={code}")
        return result.stdout + "\n" + result.stderr
    version = probe("version")
    match = re.match(r"^OpenSSL (3\.[0-9]+\.[0-9]+[a-z]?)(?:\s|$)", version)
    if not match:
        raise RuntimeError("TLS requires OpenSSL3; the explicit executable reported an incompatible implementation")
    for operation, flags in [("verify", ["-verify_ip", "-CAfile"]), ("req", ["-addext"]), ("x509", ["-extfile", "-req"])]:
        help_text = probe(operation, "-help")
        if any(not re.search(r"(?<![A-Za-z0-9_-])" + re.escape(flag) + r"(?![A-Za-z0-9_-])", help_text) for flag in flags):
            raise RuntimeError(f"TLS OpenSSL3 capability missing: stage={operation}")
    return {"binary": str(selected), "version": match[1]}


def tls_failure(error, version):
    stderr = error.stderr or ""
    if isinstance(stderr, bytes):
        stderr = stderr.decode("utf-8", errors="replace")
    text = stderr.lower()
    category = "operation-failed"
    if re.search(r"unknown option|unrecognized option|invalid option|illegal option", text):
        category = "unsupported-option"
    elif "ip address mismatch" in text or "hostname mismatch" in text:
        category = "endpoint-mismatch"
    elif "not yet valid" in text or "expired" in text:
        category = "validity-window"
    elif "issuer certificate" in text or "self-signed certificate" in text or "unable to verify" in text:
        category = "untrusted-chain"
    stage = error.cmd[1] if isinstance(error.cmd, (list, tuple)) and len(error.cmd) > 1 and error.cmd[1] in {"req", "x509", "verify"} else "certificate-operation"
    code = error.returncode if type(error.returncode) is int and 0 <= error.returncode <= 255 else "unknown"
    return f"TLS certificate operation failed: OpenSSL={version}, stage={stage}, exit={code}, category={category}; raw diagnostics remain private"


def create_ios_certificates(directory, tool):
    sys.path.insert(0, str(ROOT / "scripts/android-auth-smoke"))
    from tls import create_certificates
    try:
        ca = create_certificates(directory, openssl_binary=tool["binary"])
        # Keep the shared Android IP check and also prove the actual iOS origin.
        subprocess.run([tool["binary"], "verify", "-CAfile", str(ca), "-verify_ip", "127.0.0.1", str(directory / "server.pem")],
                       check=True, capture_output=True, timeout=60)
    except subprocess.CalledProcessError as cause:
        raise RuntimeError(tls_failure(cause, tool["version"])) from None
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError(f"TLS certificate operation unavailable or timed out: OpenSSL={tool['version']}") from None
    return ca


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


def prepare(directory, openssl_binary):
    directory = disposable_path(directory)
    if directory.exists():
        raise ValueError("Private verification directory must be new")
    tool = choose_openssl(openssl_binary)
    changes = [(ROOT / "apps" / app / "config.ts") for app in APPS]
    updated = [configure_source(path.read_text(encoding="utf-8")) for path in changes]
    directory.mkdir(mode=0o700)
    create_ios_certificates(directory / "tls", tool)
    (directory / "tls-tool.json").write_text(json.dumps(tool), encoding="utf-8")
    print(f"TLS verification passed with explicit OpenSSL {tool['version']}; both IP SANs verified")
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
    parser.add_argument("--openssl", type=Path)
    arguments = parser.parse_args()
    if arguments.action == "prepare":
        if not arguments.openssl:
            parser.error("prepare requires --openssl with the explicit Homebrew OpenSSL3 executable")
        prepare(arguments.directory, arguments.openssl)
    elif not arguments.fixture:
        parser.error("runner requires --fixture")
    else:
        runner_configuration(arguments.directory, arguments.fixture)
