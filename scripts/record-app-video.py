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
    adb("shell", "uiautomator", "dump", "/sdcard/predioon-video.xml", timeout=30)
    xml = adb("shell", "cat", "/sdcard/predioon-video.xml").stdout
    return ET.fromstring(xml[xml.index("<"):]).iter("node")


def center(node):
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", node.get("bounds")))
    return (x1 + x2) // 2, (y1 + y2) // 2


def find(label, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        for node in nodes():
            if label in (node.get("text"), node.get("content-desc")):
                return node
        time.sleep(1)
    return None


def tap(label, timeout=20):
    node = find(label, timeout)
    if node is None:
        print(f"  (sem \"{label}\" na tela, passo omitido)")
        return False
    adb("shell", "input", "tap", *map(str, center(node)))
    time.sleep(2.5)
    return True


def fill(label, value):
    node = find(label)
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
        tap("Entrar")
        time.sleep(4)
        choose = find("Residencial", 8)
        if choose is not None:
            adb("shell", "input", "tap", *map(str, center(choose)))
            time.sleep(3)
        for tab in tabs:
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
