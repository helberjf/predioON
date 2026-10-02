"""Publish only sanitized API/proxy diagnostics, never private TLS/fixture files."""
import argparse
import os
from pathlib import Path
from run_auth import redact


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    output = args.directory / "evidence"
    output.mkdir(parents=True, exist_ok=True)
    for name in ["api.log", "proxy.log"]:
        source = args.directory / name
        if source.exists():
            text = redact(source.read_text(encoding="utf-8", errors="replace"), os.environ.get("ANDROID_AUTH_PASSWORD", ""))
            (output / name).write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
