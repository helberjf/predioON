"""Helpers for scripts/ios-mac/verify.sh.

render         builds report.md and report.json from the run directory
bundle         copies only the shareable part of a run (no full logs) for publishing
team           picks the Apple team from Xcode's preferences (stdin: `defaults export com.apple.dt.Xcode -`)
device         picks the single iPhone connected by cable from `devicectl list devices --json-output`
export-options writes the ExportOptions.plist that uploads an archive to App Store Connect

Runs on the macOS system Python (3.9), so no syntax newer than that.
"""
from __future__ import annotations

import argparse
import json
import plistlib
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

LABELS = {"ok": "✅ ok", "fail": "❌ falhou", "skip": "⏭️ pulado"}
OUT_OF_SCOPE = [
    "Login e jornadas com a API real: rode o workflow manual `ios-auth.yml` no GitHub.",
    "iPhone físico, exceto quando a etapa de instalação no iPhone aparece acima.",
    "TestFlight, exceto quando a etapa de envio ao TestFlight aparece acima.",
    "Portão, gateway e demais equipamentos físicos.",
]
TAIL_LINES = 200


def read_steps(directory: Path) -> list:
    steps = []
    path = directory / "steps.tsv"
    if not path.exists():
        return steps
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        identifier, status, seconds, log, title = line.split("\t", 4)
        if status not in LABELS:
            raise ValueError(f"Unknown step status {status!r} in steps.tsv")
        steps.append({"id": identifier, "status": status, "seconds": int(seconds), "log": log or None, "title": title})
    return steps


def read_environment(directory: Path) -> dict:
    environment = {}
    path = directory / "env.tsv"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if "\t" in line:
                key, value = line.split("\t", 1)
                environment[key] = value
    return environment


def read_captures(directory: Path) -> dict:
    captures = {}
    root = directory / "captures"
    if root.is_dir():
        for result in sorted(root.glob("*/result.json")):
            captures[result.parent.name] = json.loads(result.read_text(encoding="utf-8"))
    return captures


def passed(steps: list) -> bool:
    return any(step["status"] == "ok" for step in steps) and not any(step["status"] == "fail" for step in steps)


def duration(seconds: int) -> str:
    minutes, rest = divmod(seconds, 60)
    return f"{minutes} min {rest} s" if minutes else f"{rest} s"


def render(directory: Path) -> tuple:
    steps = read_steps(directory)
    environment = read_environment(directory)
    captures = read_captures(directory)
    worktree = (directory / "worktree.txt").read_text(encoding="utf-8").strip() if (directory / "worktree.txt").exists() else ""
    ok = passed(steps)
    generated = datetime.now(timezone.utc).isoformat(timespec="seconds")
    data = {"passed": ok, "generatedAt": generated, "environment": environment, "steps": steps,
            "captures": captures, "worktreeChanges": worktree.splitlines(), "outOfScope": OUT_OF_SCOPE}

    lines = [f"# Verificação iOS no Mac: {'APROVADA ✅' if ok else 'REPROVADA ❌'}", ""]
    commit = environment.get("commit", "?")
    lines += [f"Gerado em {generated} (UTC), commit `{commit[:12]}` da branch `{environment.get('branch', '?')}`.", ""]
    if environment:
        lines += ["| Item | Valor |", "|---|---|"]
        lines += [f"| {key} | {value} |" for key, value in environment.items() if key not in ("commit", "branch")]
        lines.append("")
    lines += ["## Etapas", "", "| Etapa | Resultado | Tempo | Log |", "|---|---|---|---|"]
    for step in steps:
        log = f"`{step['log']}`" if step["log"] else ""
        lines.append(f"| {step['title']} | {LABELS[step['status']]} | {duration(step['seconds'])} | {log} |")
    failed = [step for step in steps if step["status"] == "fail"]
    if failed:
        lines += ["", "Para cada etapa que falhou, as últimas linhas do log estão em `logs/<etapa>.tail.log` no relatório publicado."]
    if captures:
        lines += ["", "## Simulador", ""]
        for app, result in captures.items():
            lines += [f"### {app}: {'aprovado' if result.get('passed') else 'reprovado'}", ""]
            if result.get("runtime"):
                lines.append(f"- Simulador: `{result.get('deviceType')}` com `{result.get('runtime')}`")
            if result.get("launchSeconds"):
                lines.append("- Abertura: " + ", ".join(f"{phase} em {value} s" for phase, value in result["launchSeconds"].items()))
            lines.append("- Fases: " + (", ".join(result.get("phases", [])) or "nenhuma"))
            if result.get("error"):
                lines.append(f"- Erro: `{result['error']}`")
            for shot in result.get("screenshots", []):
                lines += ["", f"![{app} {shot['file']}](captures/{app}/{shot['file']})"]
            lines.append("")
        lines.append("Confira as imagens: o OCR exige o formulário de login, mas uma tela estranha ainda precisa ser vista por alguém.")
    lines += ["", "## Fora do escopo desta verificação", ""] + [f"- {item}" for item in OUT_OF_SCOPE]
    lines += ["", "## Alterações no checkout após a execução", ""]
    lines += ["```", worktree, "```"] if worktree else ["Nenhuma."]
    return "\n".join(lines) + "\n", data


def write_report(directory: Path) -> bool:
    markdown, data = render(directory)
    (directory / "report.md").write_text(markdown, encoding="utf-8")
    (directory / "report.json").write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return data["passed"]


def bundle(directory: Path, destination: Path) -> None:
    """Copies the report, simulator evidence and failed-log tails; never the full logs or builds."""
    destination.mkdir(parents=True, exist_ok=True)
    for name in ("report.md", "report.json"):
        shutil.copy2(directory / name, destination / name)
    for item in sorted((directory / "captures").glob("*/*")):
        if item.suffix in (".png", ".json"):
            target = destination / "captures" / item.parent.name / item.name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, target)
    for step in read_steps(directory):
        if step["status"] == "fail" and step["log"] and (directory / step["log"]).exists():
            lines = (directory / step["log"]).read_text(encoding="utf-8", errors="replace").splitlines()
            target = destination / "logs" / f"{step['id']}.tail.log"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("\n".join(lines[-TAIL_LINES:]) + "\n", encoding="utf-8")


def team_from_defaults(content: bytes, kind: str = "any") -> str:
    """Reads the teams Xcode knows; returns the only one of the requested kind."""
    preferences = plistlib.loads(content)
    teams = {}
    for key in ("IDEProvisioningTeamByIdentifier", "IDEProvisioningTeams"):
        for entries in (preferences.get(key) or {}).values():
            for team in entries if isinstance(entries, list) else []:
                identifier = team.get("teamID")
                if not identifier:
                    continue
                free = bool(team.get("isFreeProvisioningTeam"))
                if kind == "any" or (kind == "free") == free:
                    teams[identifier] = team.get("teamName", "")
    if len(teams) != 1:
        found = ", ".join(f"{identifier} ({name})" for identifier, name in sorted(teams.items())) or "nenhum"
        raise ValueError(f"Encontrei {len(teams)} times Apple do tipo {kind}: {found}. Informe --team.")
    return next(iter(teams))


def device_from_devicectl(listing: dict) -> tuple:
    """Returns (CoreDevice identifier, UDID, name) of the single paired iPhone with an active connection."""
    devices = []
    for device in (listing.get("result") or {}).get("devices", []):
        hardware = device.get("hardwareProperties") or {}
        connection = device.get("connectionProperties") or {}
        if hardware.get("platform") != "iOS" or connection.get("pairingState") != "paired":
            continue
        if not connection.get("transportType"):
            continue
        name = (device.get("deviceProperties") or {}).get("name", "iPhone")
        devices.append((device.get("identifier"), hardware.get("udid"), name))
    if len(devices) != 1:
        raise ValueError(f"Encontrei {len(devices)} iPhones pareados e conectados; conecte um só, desbloqueado e confiando neste Mac.")
    return devices[0]


def export_options(team: str) -> bytes:
    return plistlib.dumps({
        "method": "app-store-connect", "destination": "upload", "teamID": team,
        "signingStyle": "automatic", "uploadSymbols": True, "manageAppVersionAndBuildNumber": False,
    })


def main(arguments: list) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("render").add_argument("--dir", type=Path, required=True)
    bundling = commands.add_parser("bundle")
    bundling.add_argument("--dir", type=Path, required=True)
    bundling.add_argument("--dest", type=Path, required=True)
    commands.add_parser("team").add_argument("--kind", choices=["any", "free", "paid"], default="any")
    commands.add_parser("device").add_argument("listing", type=Path)
    exporting = commands.add_parser("export-options")
    exporting.add_argument("--team", required=True)
    exporting.add_argument("--output", type=Path, required=True)
    options = parser.parse_args(arguments)
    try:
        if options.command == "render":
            return 0 if write_report(options.dir) else 1
        if options.command == "bundle":
            bundle(options.dir, options.dest)
        elif options.command == "team":
            print(team_from_defaults(sys.stdin.buffer.read(), options.kind))
        elif options.command == "device":
            print("\t".join(device_from_devicectl(json.loads(options.listing.read_text(encoding="utf-8")))))
        elif options.command == "export-options":
            options.output.write_bytes(export_options(options.team))
    except (ValueError, OSError, plistlib.InvalidFileException) as error:
        print(error, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
