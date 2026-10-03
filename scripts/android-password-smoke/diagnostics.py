"""Publish only sanitized password API/proxy logs from a disposable verification."""
import argparse
import os
from pathlib import Path
from run_password import sanitize


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    output = args.directory / "evidence"
    output.mkdir(parents=True, exist_ok=True)
    for name in ["api.log", "proxy.log"]:
        source = args.directory / name
        if source.exists():
            text = sanitize(source.read_text(encoding="utf-8", errors="replace"), os.environ.get("ANDROID_AUTH_PASSWORD", ""), os.environ.get("ANDROID_PASSWORD_NEW", ""))
            (output / name).write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
