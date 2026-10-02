"""Ephemeral HTTPS front end for the local real API; never forwards to an arbitrary host."""
import argparse
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import ssl
from urllib.parse import urlsplit

ALLOWED = {("GET", "/health"), ("GET", "/auth/me"), ("GET", "/buildings"),
           ("POST", "/auth/login"), ("POST", "/auth/refresh"), ("POST", "/auth/logout")}
MAX_BODY = 1_048_576


def make_handler(upstream_port):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, _format, *_args):
            pass  # No URL query, headers, credentials or tokens in diagnostics.

        def forward(self):
            path = urlsplit(self.path)
            if path.scheme or path.netloc or (self.command, path.path) not in ALLOWED:
                self.send_error(403)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length < 0 or length > MAX_BODY or self.headers.get("Transfer-Encoding"):
                    self.send_error(413)
                    return
                body = self.rfile.read(length) if length else None
                headers = {key: self.headers[key] for key in ("Authorization", "Content-Type") if key in self.headers}
                connection = http.client.HTTPConnection("127.0.0.1", upstream_port, timeout=20)
                try:
                    connection.request(self.command, self.path, body=body, headers=headers)
                    response = connection.getresponse()
                    payload = response.read(MAX_BODY + 1)
                    if len(payload) > MAX_BODY:
                        raise ValueError("Response too large for this verification")
                    self.send_response(response.status)
                    for key in ("Content-Type", "Cache-Control"):
                        if response.getheader(key):
                            self.send_header(key, response.getheader(key))
                    self.send_header("Content-Length", str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                    print(json.dumps({"method": self.command, "path": path.path, "status": response.status}), flush=True)
                finally:
                    connection.close()
            except (OSError, ValueError, http.client.HTTPException):
                self.send_error(502, "Local verification API unavailable")

        do_GET = forward
        do_POST = forward
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tls", type=Path, required=True)
    parser.add_argument("--upstream-port", type=int, default=3000)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", 3443), make_handler(args.upstream_port))
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(args.tls / "server.pem", args.tls / "server.key")
    server.socket = context.wrap_socket(server.socket, server_side=True)
    print("Disposable HTTPS proxy ready on loopback:3443", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
