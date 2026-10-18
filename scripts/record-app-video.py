"""Grava um vídeo de demonstração de um app no emulador Android, com dados fictícios do seed.

    python scripts/record-app-video.py resident <saida.mp4>
    python scripts/record-app-video.py operations <saida.mp4>

Precisa do app instalado no emulador, do Metro correspondente e da API com um banco
descartável. Navega tocando pelos textos visíveis (UI Automator) enquanto o
`adb screenrecord` grava. Também salva o logcat do período ao lado do vídeo, para
conferir avisos do renderer (Fabric) durante a navegação.
"""
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

ADB = "adb"
PASSWORD = "predioon123"
APPS = {
    "resident": ("com.predioon.resident", "morador@predioon.local",
                 ["Avisos", "Solicitações", "Reservas", "Transparência", "Consumo", "Acessos", "Avisos"]),
    "operations": ("com.predioon.operations", "sindico@predioon.local",
                   ["Resumo", "Alertas", "Sensores", "Ordens de serviço", "Resumo"]),
}


def adb(*args, timeout=30, check=True):
    return subprocess.run([ADB, *args], capture_output=True, text=True, timeout=timeout, check=check, encoding="utf-8", errors="replace")


def nodes():
    # A dump can fail while the screen is still changing; the caller retries.
    dump = adb("shell", "uiautomator", "dump", "/data/local/tmp/predioon-video.xml", timeout=30, check=False)
    xml = adb("shell", "cat", "/data/local/tmp/predioon-video.xml", check=False).stdout
    if dump.returncode != 0 or "<" not in xml:
        return iter(())
    try:
        return ET.fromstring(xml[xml.index("<"):]).iter("node")
    except ET.ParseError:
        return iter(())


def center(node):
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", node.get("bounds")))
    return (x1 + x2) // 2, (y1 + y2) // 2


def find(label, timeout=20, field=False, last=False):
    """A visible text or accessibility label; `field` wants the input itself, not its caption;
    `last` picks the last match, e.g. the "Entrar" button below the "Entrar" heading."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        matches = [node for node in nodes() if (
            node.get("class") == "android.widget.EditText" and label in (node.get("content-desc"), node.get("hint"), node.get("text"))
            if field else label in (node.get("text"), node.get("content-desc")))]
        if matches:
            return matches[-1] if last else matches[0]
        time.sleep(1)
    return None


def tap(label, timeout=20, last=False):
    node = find(label, timeout, last=last)
    if node is None:
        print(f"  (sem \"{label}\" na tela, passo omitido)")
        return False
    adb("shell", "input", "tap", *map(str, center(node)))
    time.sleep(2.5)
    return True


def fill(label, value):
    node = find(label, field=True)
    if node is None:
        raise SystemExit(f"Campo \"{label}\" não encontrado")
    adb("shell", "input", "tap", *map(str, center(node)))
    time.sleep(0.6)
    adb("shell", "input", "text", value.replace(" ", "%s").replace("@", "\\@"))
    time.sleep(0.6)


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in APPS:
        raise SystemExit(__doc__)
    product, out = sys.argv[1], sys.argv[2]
    package, email, tabs = APPS[product]
    adb("logcat", "-c")
    adb("shell", "pm", "clear", package)  # starts signed out, without a stored session
    remote = f"/sdcard/predioon-{product}.mp4"
    recorder = subprocess.Popen([ADB, "shell", "screenrecord", "--time-limit", "170", "--bit-rate", "6000000", remote])
    try:
        adb("shell", "monkey", "-p", package, "-c", "android.intent.category.LAUNCHER", "1")
        if find("E-mail", 60) is None:
            raise SystemExit("A tela de entrada não apareceu (Metro/app)")
        time.sleep(2)
        if product == "resident":
            tap("Tenho um convite")
            time.sleep(1.5)
            tap("Voltar para entrar")
        fill("E-mail", email)
        fill("Senha", PASSWORD)
        adb("shell", "input", "keyevent", "111")  # hide the keyboard
        tap("Entrar", last=True)
        time.sleep(4)
        # One condominium in the seed: enter it from the chooser.
        tap("Acessar condomínio", timeout=15)
        time.sleep(2)
        for tab in tabs:
            if find(tab, timeout=3) is None:
                # Further tabs live off-screen in the horizontal tab bar.
                bar = find("Avisos", timeout=5) or find("Resumo", timeout=5)
                if bar is not None:
                    y = str(center(bar)[1])
                    adb("shell", "input", "swipe", "950", y, "150", y, "500")
                    time.sleep(1.2)
            tap(tab)
            adb("shell", "input", "swipe", "540", "1700", "540", "700", "600")
            time.sleep(2)
            adb("shell", "input", "swipe", "540", "700", "540", "1700", "600")
            time.sleep(1.5)
    finally:
        time.sleep(2)
        recorder.terminate()
        try:
            recorder.wait(timeout=15)
        except subprocess.TimeoutExpired:
            recorder.kill()
        time.sleep(3)
        adb("pull", remote, out, timeout=120)
        log = adb("logcat", "-d", "-v", "time", timeout=60).stdout
        with open(re.sub(r"\.mp4$", "", out) + "-logcat.txt", "w", encoding="utf-8") as handle:
            handle.write(log)
        fabric = [line for line in log.splitlines() if "MissingViewState" in line or "Fabric" in line and " E " in line]
        print(f"{product}: vídeo {out}; {len(fabric)} linha(s) de aviso do renderer no logcat")


if __name__ == "__main__":
    main()
