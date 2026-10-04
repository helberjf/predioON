"""Bounded GET-only readiness for the disposable, certificate-verified proxy."""
import json
import http.client
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


class ReadinessFailure(RuntimeError):
    pass


class DeadlineHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, *args, expired, **kwargs):
        super().__init__(*args, **kwargs)
        self.expired = expired

    def connect(self):
        self.sock = socket.create_connection((self.host, self.port), self.timeout, self.source_address)
        if self.expired.is_set():
            self.close()
            raise TimeoutError()
        # Publish the SSL socket before its blocking handshake. The default
        # HTTPSConnection leaves a detached raw socket visible until handshake
        # completes, preventing the watchdog from interrupting that phase.
        self.sock = self._context.wrap_socket(self.sock, server_hostname=self.host, do_handshake_on_connect=False)
        if self.expired.is_set():
            self.close()
            raise TimeoutError()
        self.sock.do_handshake()


def probe(context, timeout):
    expired = threading.Event()
    connection = DeadlineHTTPSConnection("127.0.0.1", 3443, context=context, timeout=timeout, expired=expired)
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
            return False
        response = connection.getresponse()
        if response.status != 200:
            if response.status in {502, 503, 504}:
                return False
            raise ReadinessFailure("proxy_http_rejected")
        body = response.read(4097)
        if expired.is_set():
            return False
        if len(body) > 4096:
            raise ReadinessFailure("proxy_health_rejected")
        try:
            health = json.loads(body)
        except (ValueError, UnicodeError, RecursionError):
            raise ReadinessFailure("proxy_health_rejected") from None
        if not isinstance(health, dict) or health.get("ok") is not True or health.get("service") != "predioon-api":
            raise ReadinessFailure("proxy_health_rejected")
        return True
    except ssl.SSLError:
        if expired.is_set():
            return False
        raise ReadinessFailure("proxy_tls_rejected") from None
    except (TimeoutError, ConnectionError, OSError):
        return False
    except http.client.HTTPException:
        raise ReadinessFailure("proxy_http_rejected") from None
    finally:
        watchdog.cancel()
        connection.close()


def wait_for_proxy(ca, alive, *, budget=30.0, interval=0.2, exchange=None, clock=time.monotonic, sleep=time.sleep):
    if not 0 < budget <= 30 or not 0 < interval <= 1:
        raise ReadinessFailure("proxy_configuration_rejected")
    try:
        context = ssl.create_default_context(cafile=str(ca))
    except (OSError, ssl.SSLError):
        raise ReadinessFailure("proxy_configuration_rejected") from None
    exchange = exchange or (lambda timeout: probe(context, timeout))
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
        wait_for_proxy(directory / "tls/ca.pem", alive)
        category, code = "proxy_ready", 0
    except ReadinessFailure as error:
        category, code = str(error), 1
    except (ValueError, OSError):
        category, code = "proxy_configuration_rejected", 1
    print(json.dumps({"stage": "https-proxy-readiness", "category": category, "exitCode": code}, separators=(",", ":")))
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
