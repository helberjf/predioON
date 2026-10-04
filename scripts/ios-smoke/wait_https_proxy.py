"""Bounded GET-only readiness for the disposable, certificate-verified proxy."""
import json
import http.client
import errno
import os
from pathlib import Path
import socket
import ssl
import stat
import sys
import threading
import time

from prepare_auth import disposable_path

ENDPOINT = "https://127.0.0.1:3443/health"
PROBE_STAGES = frozenset({"unknown", "tcp", "tls", "request", "headers", "body"})
PROBE_OUTCOMES = frozenset({"ready", "deadline", "io-retry", "http-retry", "tls-rejected", "http-rejected", "health-rejected"})
ERRNO_CATEGORIES = frozenset({"none", "refused", "reset", "unreachable", "denied", "other"})
STARTUP_STAGES = frozenset({"resolver-skipped", "bind", "bound", "listen", "listening", "tls-load", "tls-ready", "serving"})
READINESS_CATEGORIES = frozenset({"proxy_ready", "proxy_configuration_rejected", "proxy_process_exited", "proxy_readiness_timeout", "proxy_tls_rejected", "proxy_http_rejected", "proxy_health_rejected"})


class ReadinessFailure(RuntimeError):
    pass


class ProbeDiagnostics:
    def __init__(self):
        self.attempts = 0
        self.last = {"stage": "unknown", "outcome": "io-retry", "errno": "none"}

    def record(self, stage, outcome, errno_category):
        self.attempts = min(self.attempts + 1, 999)
        self.last = {"stage": stage if isinstance(stage, str) and stage in PROBE_STAGES else "unknown",
                     "outcome": outcome if isinstance(outcome, str) and outcome in PROBE_OUTCOMES else "io-retry",
                     "errno": errno_category if isinstance(errno_category, str) and errno_category in ERRNO_CATEGORIES else "other"}

    def snapshot(self):
        return {"attempts": self.attempts, "lastProbe": dict(self.last)}


def diagnostic_errno(error):
    code = getattr(error, "errno", None)
    if isinstance(error, ConnectionRefusedError) or code == errno.ECONNREFUSED:
        return "refused"
    if isinstance(error, ConnectionResetError) or code in {errno.ECONNRESET, errno.ECONNABORTED}:
        return "reset"
    if code in {errno.ENETUNREACH, errno.EHOSTUNREACH}:
        return "unreachable"
    if isinstance(error, PermissionError) or code in {errno.EACCES, errno.EPERM}:
        return "denied"
    return "other"


def proxy_startup_stage(directory):
    try:
        path = directory / "proxy.log"
        if path.is_symlink():
            return "unavailable"
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
        with os.fdopen(os.open(path, flags), "rb") as stream:
            metadata = os.fstat(stream.fileno())
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 1_048_576:
                return "unavailable"
            stream.seek(max(0, metadata.st_size - 65_536))
            lines = stream.read(65_536).decode("utf-8", errors="replace").splitlines()
        stages = [line.removeprefix("PROXY_STARTUP:") for line in lines
                  if line.startswith("PROXY_STARTUP:") and line.removeprefix("PROXY_STARTUP:") in STARTUP_STAGES]
        return stages[-1] if stages else "unknown"
    except OSError:
        return "unavailable"


class DeadlineHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, *args, expired, **kwargs):
        super().__init__(*args, **kwargs)
        self.expired = expired

    def connect(self):
        self.phase = "tcp"
        self.sock = socket.create_connection((self.host, self.port), self.timeout, self.source_address)
        if self.expired.is_set():
            self.close()
            raise TimeoutError()
        # Publish the SSL socket before its blocking handshake. The default
        # HTTPSConnection leaves a detached raw socket visible until handshake
        # completes, preventing the watchdog from interrupting that phase.
        self.phase = "tls"
        self.sock = self._context.wrap_socket(self.sock, server_hostname=self.host, do_handshake_on_connect=False)
        if self.expired.is_set():
            self.close()
            raise TimeoutError()
        self.sock.do_handshake()
        self.phase = "request"


def probe(context, timeout, diagnostics=None):
    expired = threading.Event()
    connection = DeadlineHTTPSConnection("127.0.0.1", 3443, context=context, timeout=timeout, expired=expired)
    connection.phase = "tcp"
    outcome, errno_category = "io-retry", "none"
    physical_socket = None
    def abort():
        expired.set()
        # Read timeouts alone permit a trickling body to prolong an operation.
        # Shutdown interrupts headers/body reads at the absolute probe deadline.
        # getresponse() can detach a Connection:close socket while its body
        # reader still holds the physical stream. Keep that stream interruptible.
        channel = connection.sock or physical_socket
        if channel is not None:
            try:
                channel.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
    watchdog = threading.Timer(timeout, abort)
    watchdog.daemon = True
    watchdog.start()
    try:
        # HTTPSConnection has no environment proxy or automatic redirect. The
        # sole request has no auth header, query, body or mutable method.
        connection.request("GET", "/health")
        physical_socket = connection.sock
        if expired.is_set():
            outcome = "deadline"
            return False
        connection.phase = "headers"
        response = connection.getresponse()
        if response.status != 200:
            if response.status in {502, 503, 504}:
                outcome = "http-retry"
                return False
            outcome = "http-rejected"
            raise ReadinessFailure("proxy_http_rejected")
        connection.phase = "body"
        body = response.read(4097)
        if expired.is_set():
            outcome = "deadline"
            return False
        if len(body) > 4096:
            outcome = "health-rejected"
            raise ReadinessFailure("proxy_health_rejected")
        try:
            health = json.loads(body)
        except (ValueError, UnicodeError, RecursionError):
            outcome = "health-rejected"
            raise ReadinessFailure("proxy_health_rejected") from None
        if not isinstance(health, dict) or health.get("ok") is not True or health.get("service") != "predioon-api":
            outcome = "health-rejected"
            raise ReadinessFailure("proxy_health_rejected")
        outcome = "ready"
        return True
    except ssl.SSLError as error:
        errno_category = diagnostic_errno(error)
        if expired.is_set():
            outcome = "deadline"
            return False
        outcome = "tls-rejected"
        raise ReadinessFailure("proxy_tls_rejected") from None
    except (TimeoutError, ConnectionError, OSError) as error:
        outcome = "deadline" if expired.is_set() or isinstance(error, TimeoutError) else "io-retry"
        errno_category = diagnostic_errno(error)
        return False
    except http.client.HTTPException:
        if expired.is_set():
            outcome = "deadline"
            return False
        outcome = "http-rejected"
        raise ReadinessFailure("proxy_http_rejected") from None
    finally:
        watchdog.cancel()
        connection.close()
        if diagnostics is not None:
            diagnostics.record(connection.phase, outcome, errno_category)


def wait_for_proxy(ca, alive, *, budget=30.0, interval=0.2, exchange=None, clock=time.monotonic, sleep=time.sleep, diagnostics=None):
    if not 0 < budget <= 30 or not 0 < interval <= 1:
        raise ReadinessFailure("proxy_configuration_rejected")
    try:
        context = ssl.create_default_context(cafile=str(ca))
    except (OSError, ssl.SSLError):
        raise ReadinessFailure("proxy_configuration_rejected") from None
    exchange = exchange or (lambda timeout: probe(context, timeout, diagnostics))
    deadline = clock() + budget
    while True:
        if not alive():
            raise ReadinessFailure("proxy_process_exited")
        remaining = deadline - clock()
        if remaining <= 0:
            raise ReadinessFailure("proxy_readiness_timeout")
        if exchange(min(3.0, remaining)):
            if clock() >= deadline:
                raise ReadinessFailure("proxy_readiness_timeout")
            if not alive():
                raise ReadinessFailure("proxy_process_exited")
            return
        remaining = deadline - clock()
        if remaining <= 0:
            raise ReadinessFailure("proxy_readiness_timeout")
        sleep(min(interval, remaining))


def main(arguments):
    diagnostics = ProbeDiagnostics()
    directory = None
    try:
        if len(arguments) != 2 or arguments[0] != "--private":
            raise ReadinessFailure("proxy_configuration_rejected")
        directory = disposable_path(Path(arguments[1]))
        pid_path = directory / "proxy.pid"
        metadata = pid_path.stat()
        if pid_path.is_symlink() or not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 32:
            raise ValueError()
        text = pid_path.read_text().strip()
        if not text.isascii() or not text.isdecimal() or not 1 <= int(text) < 2 ** 31:
            raise ValueError()
        pid = int(text)
        def alive():
            # Windows interprets os.kill(pid, 0) as TerminateProcess. This
            # macOS-only harness must never use that call on Windows.
            if sys.platform == "win32":
                return False
            try:
                os.kill(pid, 0)
                return True
            except OSError:
                return False
        wait_for_proxy(directory / "tls/ca.pem", alive, diagnostics=diagnostics)
        category, code = "proxy_ready", 0
    except ReadinessFailure as error:
        category, code = str(error) if str(error) in READINESS_CATEGORIES else "proxy_configuration_rejected", 1
    except (ValueError, OSError):
        category, code = "proxy_configuration_rejected", 1
    print(json.dumps({"stage": "https-proxy-readiness", "category": category, "exitCode": code,
                     **diagnostics.snapshot(), "proxyStartup": proxy_startup_stage(directory) if directory else "unavailable"}, separators=(",", ":")))
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
