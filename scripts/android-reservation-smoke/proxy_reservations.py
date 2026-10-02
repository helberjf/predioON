"""Reuse ephemeral HTTPS transport with the minimal native reservation policy."""
import argparse
from http.server import ThreadingHTTPServer
from pathlib import Path
import ssl
import sys

from reservation_assertions import ROOT, allows
sys.path.insert(0, str(ROOT / "scripts/android-auth-smoke"))
from proxy import make_handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tls", type=Path, required=True)
    parser.add_argument("--upstream-port", type=int, default=3000)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", 3443), make_handler(args.upstream_port, allows))
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(args.tls / "server.pem", args.tls / "server.key")
    server.socket = context.wrap_socket(server.socket, server_side=True)
    print("Disposable reservation HTTPS proxy ready on loopback:3443", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
