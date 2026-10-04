"""Reuse verified HTTPS transport with the resident read-only route policy."""
import argparse
from http.server import ThreadingHTTPServer
from pathlib import Path
import ssl
import sys

from policy import allows
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/android-auth-smoke"))
from proxy import make_handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tls", type=Path, required=True)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", 3443), make_handler(3000, allows))
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(args.tls / "server.pem", args.tls / "server.key")
    server.socket = context.wrap_socket(server.socket, server_side=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
