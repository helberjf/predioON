"""TLS proxy for password verification with an exact allowlist and no domain access."""
import argparse
from http.server import ThreadingHTTPServer
from pathlib import Path
import ssl
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "android-auth-smoke"))
from proxy import ALLOWED, make_handler

PASSWORD_ALLOWED = ALLOWED | {("POST", "/auth/password")}


def handler(upstream_port):
    return make_handler(upstream_port, lambda method, path: (method, path) in PASSWORD_ALLOWED)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tls", type=Path, required=True)
    parser.add_argument("--upstream-port", type=int, default=3000)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", 3443), handler(args.upstream_port))
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(args.tls / "server.pem", args.tls / "server.key")
    server.socket = context.wrap_socket(server.socket, server_side=True)
    print("Disposable password HTTPS proxy ready on loopback:3443", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
