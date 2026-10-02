"""Assertions for real native domain screens; never an authorization substitute."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/android-smoke"))
from run import center, matches, one, parse_nodes

UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

class PrivacyViolation(AssertionError):
    pass


def allows(method, path):
    fixed = {("GET", value) for value in ["/health", "/auth/me", "/buildings", "/v1/authorization",
             "/overview/building", "/notices", "/finance", "/occurrences", "/alerts", "/telemetry/latest"]}
    fixed |= {("POST", value) for value in ["/auth/login", "/auth/refresh", "/auth/logout", "/occurrences"]}
    if (method, path) in fixed:
        return True
    return bool((method == "GET" and re.fullmatch(r"/features/buildings/[A-Za-z0-9_-]+", path)) or
                (method in {"GET", "PATCH"} and re.fullmatch(rf"/occurrences/{UUID}", path)) or
                (method == "POST" and re.fullmatch(rf"/occurrences/{UUID}/comments", path)) or
                (method == "POST" and re.fullmatch(rf"/alerts/{UUID}/acknowledge", path)))


def inspect_domain(source, package, building, required=(), forbidden=()):
    nodes = parse_nodes(source, package)
    # Privacy is checked even while the expected next screen is still loading.
    if any(secret in node.get(field, "") for secret in forbidden for node in nodes for field in ["text", "content-desc"]):
        raise PrivacyViolation("Private neighbor, draft, revoked resource or wrong tenant is visible")
    for label in [building, *required]:
        if not any(matches(node, label) for node in nodes):
            raise AssertionError(f"Expected current domain label is absent: {label}")
    return nodes


def action_node(nodes, label):
    button = one(nodes, lambda node: matches(node, label) and node.get("class") == "android.widget.Button"
               and node.get("enabled") == "true" and node.get("clickable") == "true", "enabled " + label)
    center(button)  # A native node without visible bounds cannot be tapped safely.
    return button


def assert_snapshot(snapshot, phase):
    expected = {"residentCreated": 0, "residentComments": 0, "operatorStatus": "OPEN", "operatorComments": 0,
                "alertStatus": "OPEN", "neighborStatus": "OPEN", "neighborAlertStatus": "OPEN", "neighborEvents": 0,
                "deviceGrantActive": True, "ticketGrantActive": True, "financeGrantActive": True}
    if phase not in {"initial", "resident", "actions", "device-revoked", "final"}:
        raise AssertionError("Unknown domain proof phase")
    if phase != "initial":
        expected.update(residentCreated=1, residentComments=1)
    if phase in {"actions", "device-revoked", "final"}:
        expected.update(operatorStatus="IN_PROGRESS", operatorComments=1, alertStatus="ACKNOWLEDGED")
    if phase in {"device-revoked", "final"}:
        expected["deviceGrantActive"] = False
    if phase == "final":
        expected.update(ticketGrantActive=False, financeGrantActive=False)
    if snapshot != expected:
        raise AssertionError(f"Persisted domain proof differs at {phase}: {snapshot}")
