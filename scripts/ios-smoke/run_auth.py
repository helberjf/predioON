"""Own a disposable simulator and export only approved, secret-free evidence."""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import plistlib
import re
import secrets as secret_generator
import shutil
import ssl
import struct
import subprocess
import sys
import threading
import time
import uuid
import zlib

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[1]
sys.path.insert(0, str(BASE))
from capture import iphone_target, simulator_product
from prepare_auth import APPS, disposable_path

PHASES = {"00-empty", "01-login", "02-account-empty", "03-error-preserved", "04-cancel-cleared",
          "05-keychain-restored", "06-password-changed", "07-peer-isolated", "08-cold-change-empty",
          "09-old-rejected", "10-new-literal-login", "11-logout", "12-cold-logout-empty"}
COUNTER_KEYS = {"sessions", "active_sessions", "logouts", "refresh_tokens", "rotations", "live_refresh_tokens"}
SCOPE = "two coinstalled iOS Release apps, real isolated HTTPS/API sessions, Keychain restore, password change and logout"
ROUTES = {("GET", "/health"), ("GET", "/auth/me"), ("GET", "/buildings"),
          ("POST", "/auth/login"), ("POST", "/auth/refresh"), ("POST", "/auth/logout"), ("POST", "/auth/password")}
POST_ACTIONS = {"01-login": ("/auth/login", 200), "03-error-preserved": ("/auth/password", 400),
                "05-keychain-restored": ("/auth/refresh", 200), "06-password-changed": ("/auth/password", 204),
                "09-old-rejected": ("/auth/login", 401), "10-new-literal-login": ("/auth/login", 200),
                "11-logout": ("/auth/logout", 204)}


class SecurityViolation(RuntimeError):
    pass


class EvidenceGate:
    def __init__(self):
        self.failure = None

    def reject(self, kind):
        if not self.failure:
            self.failure = {"kind": kind if kind in {"private-identity", "credential-exposure", "unprotected-password-field", "unsafe-evidence"} else "unsafe-evidence",
                            "observedAt": datetime.now(timezone.utc).isoformat()}

    def require_open(self):
        if self.failure:
            raise SecurityViolation("Evidence collection stopped at the first security rejection")


def reject_known_secrets(text, secrets):
    for value in secrets:
        stripped = value.strip()
        variants = [value, stripped, stripped[:12], stripped[-12:]] if len(stripped) >= 12 else [value]
        if any(variant and variant in text for variant in variants):
            raise SecurityViolation("Credential material is not exportable")


def reject_secrets(text, secrets):
    reject_known_secrets(text, secrets)
    if re.search(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[A-Za-z0-9_-]{64,}", text):
        raise SecurityViolation("Token material is not exportable")


def counts(state):
    sessions, active, tokens, rotations, logouts = {
        "empty": (0, 0, 0, 0, 0), "login": (1, 1, 1, 0, 0),
        "restored": (1, 1, 2, 1, 0), "changed": (1, 0, 2, 1, 0),
        "new-login": (2, 1, 3, 1, 0), "logout": (2, 0, 3, 1, 1),
    }[state]
    return {"sessions": sessions, "active_sessions": active, "refresh_tokens": tokens,
            "rotations": rotations, "logouts": logouts, "live_refresh_tokens": active}


def safe_snapshot(payload):
    if not isinstance(payload, dict) or set(payload) != set(APPS):
        raise SecurityViolation("Unexpected database snapshot shape")
    for row in payload.values():
        if not isinstance(row, dict) or set(row) != COUNTER_KEYS or any(type(value) is not int or not 0 <= value <= 100 for value in row.values()):
            raise SecurityViolation("Unexpected database snapshot fields")
    return payload


def safe_checkpoint(payload):
    if not isinstance(payload, dict) or set(payload) != {"app", "phase", "checks"}:
        raise SecurityViolation("Unexpected phase payload")
    if not isinstance(payload["app"], str) or not isinstance(payload["phase"], str) or payload["app"] not in APPS or payload["phase"] not in PHASES:
        raise SecurityViolation("Unexpected product or phase")
    checks = payload["checks"]
    if not isinstance(checks, dict) or set(checks) != {"privacy", "screen", "secure"} or any(type(value) is not bool or not value for value in checks.values()):
        raise SecurityViolation("Phase was not approved by all native checks")
    return payload


def evidence_filename(filename):
    if filename in {"result.json", "builds.json", "database-source.json"}:
        return filename
    if re.fullmatch(r"(?:resident-mobile|operations-mobile)-(?:" + "|".join(sorted(PHASES)) + r")\.(?:png|json)", filename):
        return filename
    raise SecurityViolation("Unapproved artifact filename")


def validate_png(data):
    """Validate bounded PNG chunks/CRC and decompressed scanlines, not just magic."""
    if not isinstance(data, bytes) or not 1024 < len(data) <= 8_000_000 or not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise SecurityViolation("Image is not a bounded PNG")
    offset, header, compressed, ended, idat_closed, palette = 8, None, bytearray(), False, False, None
    while offset < len(data):
        if offset + 12 > len(data):
            raise SecurityViolation("PNG chunk is truncated")
        size = struct.unpack(">I", data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        end = offset + 12 + size
        if end > len(data) or not re.fullmatch(b"[A-Za-z]{4}", kind):
            raise SecurityViolation("PNG chunk is invalid")
        contents = data[offset + 8:end - 4]
        if zlib.crc32(kind + contents) != struct.unpack(">I", data[end - 4:end])[0]:
            raise SecurityViolation("PNG chunk CRC is invalid")
        if header is None and kind != b"IHDR":
            raise SecurityViolation("PNG does not begin with IHDR")
        if kind == b"IHDR":
            if header is not None or size != 13:
                raise SecurityViolation("PNG header is invalid")
            header = struct.unpack(">IIBBBBB", contents)
            width, height, depth, color, compression, filtering, interlace = header
            allowed_depths = {0: {1, 2, 4, 8, 16}, 2: {8, 16}, 3: {1, 2, 4, 8}, 4: {8, 16}, 6: {8, 16}}
            if not 1 <= width <= 5000 or not 1 <= height <= 5000 or depth not in allowed_depths.get(color, set()) or compression != 0 or filtering != 0 or interlace != 0:
                raise SecurityViolation("PNG dimensions or encoding are unsupported")
        elif kind == b"PLTE":
            if compressed or palette is not None or not 3 <= size <= 768 or size % 3:
                raise SecurityViolation("PNG palette is invalid")
            palette = size // 3
        elif kind == b"IDAT":
            if idat_closed:
                raise SecurityViolation("PNG IDAT chunks are not contiguous")
            compressed.extend(contents)
        elif kind == b"IEND":
            if size != 0 or not compressed or end != len(data):
                raise SecurityViolation("PNG end or trailing data is invalid")
            ended = True
        elif not kind[0] & 32:
            raise SecurityViolation("PNG has an unknown critical chunk")
        elif compressed:
            idat_closed = True
        offset = end
    if not header or not ended or (header[3] == 3 and (palette is None or palette > 2 ** header[2])):
        raise SecurityViolation("PNG required chunks are absent")
    width, height, depth, color, *_ = header
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color]
    stride = (width * channels * depth + 7) // 8
    expected = height * (stride + 1)
    if expected > 64_000_000:
        raise SecurityViolation("PNG scanlines exceed the decoding bound")
    try:
        decoder = zlib.decompressobj()
        pixels = decoder.decompress(bytes(compressed), expected + 1)
        if len(pixels) != expected or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail or any(pixels[row * (stride + 1)] > 4 for row in range(height)):
            raise SecurityViolation("PNG scanlines are invalid")
    except zlib.error:
        raise SecurityViolation("PNG pixels cannot be decompressed") from None
    return width, height


def safe_events(events):
    if not isinstance(events, list):
        raise SecurityViolation("Unexpected API events shape")
    for item in events:
        if not isinstance(item, dict) or set(item) != {"method", "path", "status"} or not isinstance(item["method"], str) or not isinstance(item["path"], str) or (item["method"], item["path"]) not in ROUTES or type(item["status"]) is not int or not 100 <= item["status"] <= 599:
            raise SecurityViolation("Unapproved proxy diagnostic")
    return events


def safe_json(filename, payload):
    """Check the entire schema again at the publication boundary."""
    sha = lambda value: isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value)
    if filename == "builds.json":
        if not isinstance(payload, list) or len(payload) != 2:
            raise SecurityViolation("Unexpected build metadata")
        for item, app in zip(payload, APPS):
            if not isinstance(item, dict) or set(item) != {"app", "bundleId", "mode", "sha256"} or item["app"] != app or item["bundleId"] != APPS[app] or item["mode"] != "Release" or not sha(item["sha256"]):
                raise SecurityViolation("Unexpected build metadata fields")
    elif filename == "database-source.json":
        if payload != {"postgres": "16.4", "timescale": "2.17.2",
                       "postgresSha256": "971766d645aa73e93b9ef4e3be44201b4f45b5477095b049125403f9f3386d6f",
                       "timescaleSha256": "85dd01deaa0728f95d117c1a75ca0cbf78f3301e6ab2b98bebe5f7c95b793acb"}:
            raise SecurityViolation("Unexpected database source metadata")
    elif filename == "result.json":
        required = {"passed", "scope", "commit", "runtime", "sdkVersion", "steps"}
        if not isinstance(payload, dict) or not required <= set(payload) or set(payload) - required - {"failureKind", "cleanupFailed", "securityFailure"}:
            raise SecurityViolation("Unexpected result fields")
        if type(payload["passed"]) is not bool or payload["scope"] != SCOPE or not isinstance(payload["commit"], str) or not re.fullmatch(r"[a-f0-9]{40}", payload["commit"]) or not isinstance(payload["runtime"], str) or not re.fullmatch(r"com\.apple\.CoreSimulator\.SimRuntime\.iOS-[0-9-]+", payload["runtime"]) or not isinstance(payload["sdkVersion"], str) or not re.fullmatch(r"[0-9]+(?:\.[0-9]+){0,2}", payload["sdkVersion"]):
            raise SecurityViolation("Unexpected result values")
        if not isinstance(payload["steps"], list):
            raise SecurityViolation("Unexpected result steps")
        for index, step in enumerate(payload["steps"]):
            if not isinstance(step, dict) or set(step) != {"app", "phase", "passed"} or step["passed"] is not True or index >= len(expected_order()) or (step["app"], step["phase"]) != expected_order()[index]:
                raise SecurityViolation("Unexpected phase order in result")
        if payload["passed"] and (len(payload["steps"]) != len(expected_order()) or any(key in payload for key in ["failureKind", "cleanupFailed", "securityFailure"])):
            raise SecurityViolation("Incomplete or failed journey cannot be approved")
        if "failureKind" in payload and payload["failureKind"] not in {"security-rejection", "native-journey-failed", "phase-rejected"}:
            raise SecurityViolation("Unexpected failure category")
        if "cleanupFailed" in payload and type(payload["cleanupFailed"]) is not bool:
            raise SecurityViolation("Unexpected cleanup status")
        if "securityFailure" in payload:
            failure = payload["securityFailure"]
            if not isinstance(failure, dict) or set(failure) != {"kind", "observedAt"} or failure["kind"] not in {"private-identity", "credential-exposure", "unprotected-password-field", "unsafe-evidence"} or not isinstance(failure["observedAt"], str) or not re.fullmatch(r"[0-9T:.+-]+", failure["observedAt"]):
                raise SecurityViolation("Unexpected security failure metadata")
    else:
        if not isinstance(payload, dict) or set(payload) != {"app", "phase", "checks", "snapshot", "apiEvents", "screenshotSha256"}:
            raise SecurityViolation("Unexpected phase evidence fields")
        safe_checkpoint({key: payload[key] for key in ["app", "phase", "checks"]})
        if filename != payload["app"] + "-" + payload["phase"] + ".json" or not sha(payload["screenshotSha256"]):
            raise SecurityViolation("Phase metadata does not match its filename")
        safe_snapshot(payload["snapshot"])
        safe_events(payload["apiEvents"])
    return payload


def export_evidence(private, public, secrets):
    """Validate every file before creating the artifact directory or output flag."""
    if public.exists() or public.is_symlink():
        raise SecurityViolation("Public evidence destination is not new")
    entries = list(private.iterdir())
    names = {path.name for path in entries}
    if not {"result.json", "builds.json"} <= names:
        raise SecurityViolation("Mandatory evidence metadata absent")
    approved = {}
    for path in entries:
        evidence_filename(path.name)
        if not path.is_file() or path.is_symlink():
            raise SecurityViolation("Unexpected evidence staging entry")
        data = path.read_bytes()
        if path.suffix == ".json":
            try:
                payload = safe_json(path.name, json.loads(data))
            except (ValueError, TypeError, KeyError):
                raise SecurityViolation("Malformed evidence JSON") from None
            # Only the closed SHA fields are exempt from the opaque-token rule.
            reject_known_secrets(json.dumps(payload, ensure_ascii=False), secrets)
            text = re.sub(r'"(?:sha256|screenshotSha256|postgresSha256|timescaleSha256)":\s*"[a-f0-9]{64}"', '"verifiedDigest": "sha256"', json.dumps(payload, ensure_ascii=False))
            reject_secrets(text, secrets)
            approved[path.name] = payload
        else:
            validate_png(data)
            reject_known_secrets(data.decode("latin-1"), secrets)
    for name, payload in approved.items():
        if name not in {"result.json", "builds.json", "database-source.json"}:
            png = private / (name[:-5] + ".png")
            if png.name not in names or hashlib.sha256(png.read_bytes()).hexdigest() != payload["screenshotSha256"]:
                raise SecurityViolation("Phase image digest mismatch")
    if any(name.endswith(".png") and name[:-4] + ".json" not in approved for name in names):
        raise SecurityViolation("Image has no approved native checkpoint")
    public.mkdir(parents=True)
    for path in entries:
        shutil.copyfile(path, public / path.name)


def owned_simulator(value, created):
    try:
        canonical = str(uuid.UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise ValueError("An explicit owned simulator UUID is required") from None
    if canonical == str(uuid.UUID(int=0)) or canonical != created:
        raise ValueError("Only the simulator created by this run is allowed")
    return canonical


def command(*arguments, timeout=60, private_log=None):
    try:
        result = subprocess.run(arguments, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError("Private verification command unavailable or timed out") from None
    if private_log:
        Path(private_log).write_text(result.stdout + result.stderr, encoding="utf-8")
    if result.returncode:
        # A failure can contain typeText/password/DSNs: never include stdout,
        # stderr, command arguments or the original exception in public output.
        raise RuntimeError("Private verification command failed")
    return result.stdout.strip()


def database_snapshot(fixture):
    return safe_snapshot(json.loads(command("pnpm", "--filter", "@predioon/api", "exec", "tsx",
        str(ROOT / "scripts/android-auth-smoke/fixture.mts"), "snapshot", str(fixture), timeout=40)))


def proxy_events(path):
    events = []
    if not path.is_file():
        return events
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.startswith("{"):
            continue  # Existing proxy's one static startup line is not evidence.
        item = json.loads(line)
        events.extend(safe_events([item]))
    return events


def wait_proxy_events(path, offset, required):
    deadline = time.monotonic() + 15
    while True:
        all_events = proxy_events(path)
        requests = [event for event in all_events[offset:] if event["method"] == "POST"]
        if requests:
            assert_post_actions(requests, required)
            return all_events
        if time.monotonic() >= deadline:
            raise AssertionError("Expected single real API response is absent")
        time.sleep(0.25)


def assert_post_actions(events, required):
    requests = [event for event in events if event["method"] == "POST"]
    expected = [{"method": "POST", "path": required[0], "status": required[1]}] if required else []
    if requests != expected:
        raise AssertionError("Real API phase has an unexpected or duplicated POST action")


def validate_phase_events(events, phase):
    assert_post_actions(events, POST_ACTIONS.get(phase))
    if phase in {"00-empty", "08-cold-change-empty", "12-cold-logout-empty"} and any(event["path"] in {"/auth/me", "/auth/refresh"} for event in events):
        raise AssertionError("Cold logged-out launch attempted to restore a credential")


def expected_order():
    products = list(APPS)
    order = [(app, phase) for app in products for phase in ["00-empty", "01-login"]]
    for app in products:
        order += [(app, phase) for phase in ["02-account-empty", "03-error-preserved", "04-cancel-cleared", "05-keychain-restored", "06-password-changed"]]
        order += [(next(peer for peer in products if peer != app), "07-peer-isolated")]
        order += [(app, phase) for phase in ["08-cold-change-empty", "09-old-rejected", "10-new-literal-login", "11-logout", "12-cold-logout-empty"]]
    return order


class Coordinator:
    def __init__(self, private, output, fixture, simulator, token, secrets):
        self.private, self.output, self.fixture = private, output, fixture
        self.simulator, self.token, self.secrets = simulator, token, secrets
        self.gate = EvidenceGate()
        self.states = {app: "empty" for app in APPS}
        self.order, self.steps, self.started, self.finished = expected_order(), [], False, False
        self.event_offset, self.error_kind = 0, None
        self.start_offset = 0
        self.pending = None
        self.lock = threading.Lock()

    def request(self, path, payload):
        with self.lock:
            if path == "/rejection":
                if not isinstance(payload, dict) or set(payload) != {"kind"}:
                    self.gate.reject("unsafe-evidence")
                else:
                    self.gate.reject(payload["kind"])
                raise SecurityViolation("Native security rejected the observation")
            self.gate.require_open()
            if path == "/capture":
                if not isinstance(payload, dict) or set(payload) != {"app", "phase", "checks", "nonce", "png"} or not self.pending:
                    raise SecurityViolation("Unapproved image handshake")
                item = safe_checkpoint({key: payload[key] for key in ["app", "phase", "checks"]})
                pending = self.pending
                if item != pending["item"] or not isinstance(payload["nonce"], str) or not secret_generator.compare_digest(payload["nonce"], pending["nonce"]) or time.monotonic() > pending["expires"]:
                    raise SecurityViolation("Image approval is stale or mismatched")
                validate_phase_events(proxy_events(self.private / "proxy.log")[self.event_offset:], item["phase"])
                self.pending = None  # A capture token is single-use, including failure.
                if not isinstance(payload["png"], str) or len(payload["png"]) > 12_000_000:
                    raise SecurityViolation("Image payload exceeds the verification bound")
                try:
                    data = base64.b64decode(payload["png"], validate=True)
                except (ValueError, TypeError):
                    raise SecurityViolation("Image payload is not encoded PNG") from None
                validate_png(data)
                prefix = item["app"] + "-" + item["phase"]
                evidence = {**item, "snapshot": pending["snapshot"], "apiEvents": pending["events"],
                            "screenshotSha256": hashlib.sha256(data).hexdigest()}
                reject_secrets(json.dumps(item, ensure_ascii=False), self.secrets)
                (self.output / evidence_filename(prefix + ".png")).write_bytes(data)
                (self.output / evidence_filename(prefix + ".json")).write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
                self.steps.append({"app": item["app"], "phase": item["phase"], "passed": True})
                self.states, self.event_offset = pending["states"], pending["eventOffset"]
                return
            if path == "/start" and payload == {} and not self.started:
                if database_snapshot(self.fixture) != {app: counts("empty") for app in APPS}:
                    raise AssertionError("Isolated accounts are not initially session-free")
                self.started = True
                self.event_offset = len(proxy_events(self.private / "proxy.log"))
                self.start_offset = self.event_offset
                return
            if not self.started:
                raise AssertionError("Native journey has not started")
            if path == "/finish" and payload == {} and not self.pending and len(self.steps) == len(self.order):
                posts = [event for event in proxy_events(self.private / "proxy.log")[self.start_offset:] if event["method"] == "POST"]
                expected = [{"method": "POST", "path": POST_ACTIONS[phase][0], "status": POST_ACTIONS[phase][1]}
                            for _app, phase in self.order if phase in POST_ACTIONS]
                if len(expected) != 14 or posts != expected:
                    raise AssertionError("Complete journey must have exactly the fourteen ordered POST actions")
                self.finished = True
                return
            if path != "/checkpoint" or self.finished or self.pending:
                raise SecurityViolation("Unapproved coordinator action")
            item = safe_checkpoint(payload)
            app, phase = item["app"], item["phase"]
            if len(self.steps) >= len(self.order) or (app, phase) != self.order[len(self.steps)]:
                raise AssertionError("Native phases are out of order")
            state = {"01-login": "login", "05-keychain-restored": "restored", "06-password-changed": "changed",
                     "10-new-literal-login": "new-login", "11-logout": "logout"}.get(phase)
            proposed = {**self.states, **({app: state} if state else {})}
            required = POST_ACTIONS.get(phase)
            # Logout clears the UI before its HTTP request completes. Wait for
            # the real proxy response, then inspect the committed DB state.
            all_events = wait_proxy_events(self.private / "proxy.log", self.event_offset, required) if required else proxy_events(self.private / "proxy.log")
            events = all_events[self.event_offset:]
            validate_phase_events(events, phase)
            snapshot = database_snapshot(self.fixture)
            if snapshot != {product: counts(status) for product, status in proposed.items()}:
                raise AssertionError("Real session/token snapshot does not match the native phase")
            all_events = proxy_events(self.private / "proxy.log")
            events = all_events[self.event_offset:]
            validate_phase_events(events, phase)
            self.gate.require_open()
            nonce = secret_generator.token_hex(16)
            self.pending = {"item": item, "nonce": nonce, "expires": time.monotonic() + 30,
                            "snapshot": snapshot, "events": events, "states": proposed, "eventOffset": len(all_events)}
            return {"nonce": nonce}


def handler(coordinator):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            if self.headers.get("Authorization") != "Bearer " + coordinator.token:
                self.send_error(403); return
            try:
                if self.headers.get("Transfer-Encoding"):
                    raise SecurityViolation("Chunked coordinator input refused")
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 <= size <= (12_010_000 if self.path == "/capture" else 4096):
                    raise SecurityViolation("Coordinator payload too large")
                payload = json.loads(self.rfile.read(size))
                response = coordinator.request(self.path, payload)
            except SecurityViolation:
                coordinator.gate.reject("unsafe-evidence")
                coordinator.error_kind = "security-rejection"
                self.send_error(409, "Native verification rejected"); return
            except Exception:
                coordinator.error_kind = "phase-rejected"
                self.send_error(409, "Native verification rejected"); return
            if response:
                data = json.dumps(response).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers(); self.wfile.write(data)
            else:
                self.send_response(204); self.end_headers()
    return Handler


def run(private, output, resident, operations):
    private = disposable_path(private)
    output = output.resolve()
    expected_output = (ROOT / ".local/ios-auth/evidence").resolve()
    if output != expected_output or output.is_symlink() or output.exists():
        raise ValueError("Only a new fixed evidence staging folder may be exported")
    fixture = private / "fixture.json"
    credentials = json.loads((private / "secrets.json").read_text())
    secrets = list(credentials.values()) + ["DefinitelyWrong123"]
    # Validate products before creating or changing any simulator.
    builds = []
    for app, application in zip(APPS, [resident, operations]):
        application = application.resolve(strict=True)
        with (application / "Info.plist").open("rb") as file:
            info = plistlib.load(file)
        if simulator_product(info) != APPS[app]:
            raise ValueError("Simulator product identity mismatch")
        binary = application / info["CFBundleExecutable"]
        command("codesign", "--verify", "--strict", str(application))
        if not re.search(r"sectname\s+__entitlements\b", command("xcrun", "otool", "-l", str(binary))):
            raise ValueError("Simulator binary is missing embedded entitlements")
        builds.append({"app": app, "bundleId": APPS[app], "mode": "Release", "sha256": hashlib.sha256(binary.read_bytes()).hexdigest()})
    candidate = private / "approved-evidence"
    candidate.mkdir()
    (candidate / "builds.json").write_text(json.dumps(builds, indent=2))
    source_metadata = Path(os.environ["IOS_DB_ROOT"]) / "source-versions.json"
    safe_json("database-source.json", json.loads(source_metadata.read_text()))
    shutil.copyfile(source_metadata, candidate / "database-source.json")
    sdk = command("xcrun", "--sdk", "iphonesimulator", "--show-sdk-version")
    runtime, device = iphone_target(json.loads(command("xcrun", "simctl", "list", "--json")), sdk)
    simulator = None
    coordinator = None
    server = None
    report = {"passed": False, "scope": SCOPE,
              "commit": os.environ.get("GITHUB_SHA"), "runtime": runtime, "sdkVersion": sdk, "steps": []}
    try:
        created = str(uuid.UUID(command("xcrun", "simctl", "create", "PredioON-auth-" + str(uuid.uuid4()), device, runtime)))
        simulator = owned_simulator(created, created)
        command("xcrun", "simctl", "bootstatus", simulator, "-b", timeout=180)
        command("xcrun", "simctl", "keychain", simulator, "add-root-cert", str(private / "tls/ca.pem"))
        for application in [resident, operations]:
            command("xcrun", "simctl", "install", simulator, str(application.resolve()), timeout=120)
        coordinator = Coordinator(private, candidate, fixture, simulator, credentials["IOS_AUTH_COORDINATOR_TOKEN"], secrets)
        server = ThreadingHTTPServer(("127.0.0.1", 3555), handler(coordinator))
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(private / "tls/server.pem", private / "tls/server.key")
        server.socket = context.wrap_socket(server.socket, server_side=True)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        project = str(private / "AuthJourney.xcodeproj")
        derived = str(private / "runner-build")
        common = ["xcodebuild", "-project", project, "-scheme", "AuthJourney", "-configuration", "Release",
                  "-destination", "platform=iOS Simulator,id=" + simulator, "-derivedDataPath", derived,
                  "CODE_SIGNING_ALLOWED=YES", "CODE_SIGN_IDENTITY=-", "-parallel-testing-enabled", "NO",
                  "-maximum-concurrent-test-simulator-destinations", "1"]
        command(*common, "build-for-testing", timeout=240, private_log=private / "runner-build.log")
        runner_info = private / "runner-build/Build/Products/Release-iphonesimulator/AuthJourney-Runner.app/Info.plist"
        with runner_info.open("rb") as source:
            runner_plist = plistlib.load(source)
        runner_ats = runner_plist.get("NSAppTransportSecurity", {})
        if runner_ats.get("NSAllowsArbitraryLoads") or runner_ats.get("NSExceptionDomains"):
            raise AssertionError("Standalone runner must use trusted HTTPS without insecure ATS exceptions")
        command(*common, "test-without-building", "-only-testing:AuthJourney/AuthJourney/testBothInstalledReleaseApps",
                "-resultBundlePath", str(private / "AuthJourney.xcresult"), timeout=1200, private_log=private / "runner-test.log")
        if not coordinator.finished or len(coordinator.steps) != len(coordinator.order):
            raise AssertionError("The native runner did not finish all approved phases")
        coordinator.gate.require_open()
        report["passed"] = True
    except SecurityViolation:
        report["failureKind"] = "security-rejection"
    except Exception:
        report["failureKind"] = "native-journey-failed"
    finally:
        if server:
            server.shutdown(); server.server_close()
        if coordinator:
            report["steps"] = coordinator.steps
            if coordinator.gate.failure:
                report["passed"] = False
                report["securityFailure"] = coordinator.gate.failure
            if coordinator.error_kind:
                report["passed"] = False
                report["failureKind"] = coordinator.error_kind
        # Cleanup does not inspect/capture either application's private content.
        if simulator:
            for action in ["shutdown", "delete"]:
                try:
                    command("xcrun", "simctl", action, owned_simulator(simulator, simulator), timeout=60)
                except Exception:
                    report["passed"] = False
                    report["cleanupFailed"] = True
        (candidate / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
        export_evidence(candidate, output, secrets)
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as outputs:
            outputs.write("evidence-ready=true\n")
    if not report["passed"]:
        raise SystemExit("Authenticated iOS verification failed; only approved evidence was staged")
    print("Authenticated iOS verification completed; all approved phases staged")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--private", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / ".local/ios-auth/evidence")
    parser.add_argument("--resident", type=Path, required=True)
    parser.add_argument("--operations", type=Path, required=True)
    args = parser.parse_args()
    run(args.private, args.output, args.resident, args.operations)
