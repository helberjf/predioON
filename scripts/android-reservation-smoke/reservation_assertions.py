"""Assertions for native reservations; backend remains the authorization authority."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/android-domain-smoke"))
from assertions import PrivacyViolation, inspect_domain, UUID
from run import center, matches, one, parse_nodes

EMPTY = "Nenhum horário ocupado nesta data."
DENIED = "Sem permissão para consultar os horários desta área."
CALENDAR_END = "Os horários podem mudar. A disponibilidade é verificada ao enviar a reserva."


def allows(method, path):
    fixed = {("GET", value) for value in ["/health", "/auth/me", "/buildings", "/v1/authorization", "/common-areas", "/reservations", "/reservations/availability"]}
    fixed |= {("POST", value) for value in ["/auth/login", "/auth/refresh", "/auth/logout", "/reservations"]}
    return (method, path) in fixed or bool((method == "GET" and re.fullmatch(r"/features/buildings/[A-Za-z0-9_-]+", path)) or (method == "DELETE" and re.fullmatch(rf"/reservations/{UUID}", path)))


def inspect_calendar(source, package, building, state, forbidden):
    nodes = inspect_domain(source, package, building, ["Horários ocupados"], forbidden)
    start = one(nodes, lambda node: matches(node, "Horários ocupados"), "calendar heading")
    end = one(nodes, lambda node: matches(node, CALENDAR_END), "calendar ending")
    first, last = nodes.index(start), nodes.index(end)
    if last <= first:
        raise AssertionError("Calendar content boundaries are invalid")
    calendar_nodes = nodes[first:last]
    intervals = [node.get("text", "") for node in calendar_nodes if re.search(r"\d\d:\d\d.* até .*\d\d:\d\d", node.get("text", ""))]
    if state == "occupied":
        if len(intervals) != 1 or not re.search(r"19:00(?::00)?.* até .*20:00(?::00)?", intervals[0]) or any(matches(node, value) for node in calendar_nodes for value in [EMPTY, DENIED]):
            raise AssertionError("Expected the private calendar's occupied 19:00–20:00 interval")
    elif state in {"empty", "denied"}:
        expected, wrong = (EMPTY, DENIED) if state == "empty" else (DENIED, EMPTY)
        if intervals or any(matches(node, wrong) for node in calendar_nodes) or not any(matches(node, expected) for node in calendar_nodes):
            raise AssertionError("Calendar empty/denied state must have no occupancy intervals")
    else:
        raise AssertionError("Unknown calendar state")
    return nodes


def inspect_confirmation(source, package):
    nodes = parse_nodes(source, package)
    one(nodes, lambda n: n.get("resource-id") == "android:id/alertTitle" and matches(n, "Cancelar reserva?"), "reservation confirmation title")
    one(nodes, lambda n: matches(n, "O horário será liberado para outros moradores."), "reservation confirmation message")
    result = {}
    for key, identifier, label in [("back", "button2", "Voltar"), ("confirm", "button1", "Cancelar reserva")]:
        target = one(nodes, lambda n: n.get("resource-id") == "android:id/" + identifier and n.get("class") == "android.widget.Button" and n.get("text", "").casefold() == label.casefold() and n.get("clickable") == "true" and n.get("enabled") == "true", "native " + key)
        center(target)
        result[key] = target
    return result


def assert_snapshot(snapshot, phase):
    phases = ["initial", "conflict", "released", "confirmed", "back", "cancelled", "pending", "revoked"]
    if phase not in phases:
        raise AssertionError("Unknown reservation proof phase")
    index = phases.index(phase)
    expected = {"ownTotal": 0, "ownConfirmed": 0, "ownPending": 0, "ownCancelled": 0, "createdAudits": 0, "cancelledAudits": 0, "neighborStatus": "CONFIRMED", "calendarGrantsActive": 2, "foreignStatus": "CONFIRMED"}
    if index >= 2:
        expected["neighborStatus"] = "CANCELLED"
    if index >= 3:
        expected.update(ownTotal=1, ownConfirmed=1, createdAudits=1)
    if index >= 5:
        expected.update(ownConfirmed=0, ownCancelled=1, cancelledAudits=1)
    if index >= 6:
        expected.update(ownTotal=2, ownPending=1, createdAudits=2)
    if index >= 7:
        expected["calendarGrantsActive"] = 0
    if snapshot != expected:
        raise AssertionError(f"Persisted reservation proof differs at {phase}: {snapshot}")
