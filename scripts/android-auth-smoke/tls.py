"""Create disposable CI certificates and trust them only in the verification APKs."""
import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "android-smoke"))
from prepare import APPS, AUTH_ORIGIN, configure_source

NETWORK_CONFIG = '''<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors><certificates src="@raw/ci_auth_ca" /></trust-anchors>
  </base-config>
</network-security-config>
'''


def configure_manifest(source):
    if "networkSecurityConfig" in source or len(re.findall(r"<application\s", source)) != 1:
        raise ValueError("Unexpected existing Android network policy; review the CI adapter")
    return re.sub(r"<application\s", '<application android:networkSecurityConfig="@xml/ci_auth_network"\n      ', source, count=1)


def create_certificates(directory):
    directory.mkdir(parents=True, exist_ok=True)
    if any(directory.iterdir()):
        raise ValueError("TLS directory must be new and empty")
    def openssl(*args):
        subprocess.run(["openssl", *map(str, args)], check=True, capture_output=True, timeout=60)
    ca_key, ca = directory / "ca.key", directory / "ca.pem"
    key, csr, cert = directory / "server.key", directory / "server.csr", directory / "server.pem"
    openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "1",
            "-subj", "/CN=Predio ON disposable Android CI CA", "-keyout", ca_key, "-out", ca,
            "-addext", "basicConstraints=critical,CA:TRUE,pathlen:0", "-addext", "keyUsage=critical,keyCertSign,cRLSign")
    openssl("req", "-new", "-newkey", "rsa:2048", "-nodes", "-sha256", "-subj", "/CN=10.0.2.2", "-keyout", key, "-out", csr)
    extensions = directory / "server.ext"
    extensions.write_text("basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:10.0.2.2,IP:127.0.0.1\n", encoding="ascii")
    openssl("x509", "-req", "-in", csr, "-CA", ca, "-CAkey", ca_key, "-CAcreateserial", "-days", "1", "-sha256", "-extfile", extensions, "-out", cert)
    openssl("verify", "-CAfile", ca, "-verify_ip", "10.0.2.2", cert)
    ca_key.chmod(0o600)
    key.chmod(0o600)
    return ca


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if os.environ.get("CI") != "true":
        raise SystemExit("APK trust adapter is restricted to the disposable CI checkout")
    # Inspect every target before modifying any source file.
    changes = []
    for app in APPS:
        base = ROOT / "apps" / app
        manifest = base / "android/app/src/main/AndroidManifest.xml"
        config = base / "config.ts"
        changes.append((base, manifest, configure_manifest(manifest.read_text(encoding="utf-8")), config,
                        configure_source(config.read_text(encoding="utf-8"), AUTH_ORIGIN)))
    ca = create_certificates(args.output)
    for base, manifest, manifest_source, config, config_source in changes:
        resources = base / "android/app/src/main/res"
        (resources / "raw").mkdir(exist_ok=True)
        (resources / "xml").mkdir(exist_ok=True)
        shutil.copyfile(ca, resources / "raw/ci_auth_ca.pem")
        (resources / "xml/ci_auth_network.xml").write_text(NETWORK_CONFIG, encoding="utf-8")
        manifest.write_text(manifest_source, encoding="utf-8")
        config.write_text(config_source, encoding="utf-8")
    print("Both verification APKs configured for the isolated HTTPS API; no system trust was modified")


if __name__ == "__main__":
    main()
