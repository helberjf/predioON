"""Own only this Linux CI job's API/proxy process groups, identified by start time."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys

from run_renderer import ClosedParser, ROOT, guarded_directory


def identity(pid):
    source = Path(f"/proc/{pid}/stat").read_text()
    fields = source[source.rfind(")") + 2:].split()
    # Linux proc fields 5/6/22, after the parenthesized command (field 2).
    return {"pid": pid, "group": int(fields[2]), "session": int(fields[3]), "start": fields[19]}


def start(directory):
    commands = {"api": ["pnpm", "--filter", "@predioon/api", "exec", "tsx", "src/server.ts"],
                "proxy": [sys.executable, "-B", str(ROOT / "scripts/android-renderer-smoke/proxy_renderer.py"), "--tls", str(directory / "tls")]}
    for name, command in commands.items():
        target = directory / f"{name}.process.json"
        if target.exists() or target.is_symlink():
            raise ValueError()
        with (directory / f"{name}.log").open("xb") as log:
            child = subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=log, start_new_session=True)
        try:
            recorded = identity(child.pid)
            if recorded["group"] != child.pid or recorded["session"] != child.pid:
                raise ValueError()
            with target.open("x", encoding="utf-8") as output:
                json.dump(recorded, output)
        except Exception:
            child.terminate()
            child.wait(timeout=5)
            raise


def stop(directory):
    for name in ["proxy", "api"]:
        target = directory / f"{name}.process.json"
        if not target.exists():
            continue
        if target.is_symlink() or not target.is_file() or target.stat().st_size > 1024:
            raise ValueError()
        recorded = json.loads(target.read_text())
        if (set(recorded) != {"pid", "group", "session", "start"} or type(recorded["pid"]) is not int or
                not 1 < recorded["pid"] < 2 ** 31 or recorded["group"] != recorded["pid"] or
                recorded["session"] != recorded["pid"]):
            raise ValueError()
        try:
            actual = identity(recorded["pid"])
        except FileNotFoundError:
            continue  # Never signal a reused group without its recorded leader.
        if actual != recorded:
            raise ValueError()
        os.killpg(recorded["pid"], signal.SIGTERM)


def main():
    try:
        parser = ClosedParser(description=__doc__, add_help=False)
        parser.add_argument("action", choices=["start", "stop"])
        parser.add_argument("--private", type=Path, required=True)
        args = parser.parse_args()
        if sys.platform != "linux":
            raise ValueError()
        directory = guarded_directory(args.private)
        (start if args.action == "start" else stop)(directory)
    except Exception:
        print('{"stage":"renderer-services","category":"service-operation-rejected"}')
        return 1
    print(json.dumps({"stage": "renderer-services", "category": args.action + "-completed"}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
