#!/usr/bin/env python3
"""
Lokální náhled appky (jen pro vývoj – produkce jede na GitHub Pages).

    python3 scripts/serve.py [port]

Appka potřebuje http:// (ne file://) kvůli fetch() na data/*.json a kvůli
Web Crypto API v heslovém zámku. Na localhostu je zámek v „lokálním náhledu“,
dokud si nedoplníš PASSWORD_SHA256 v js/auth.js.
"""

import functools
import http.server
import os
import socketserver
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4173


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # ať se při vývoji nekešují JSONy ani skripty
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    os.chdir(ROOT)
    handler = functools.partial(Handler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), handler) as httpd:
        print(f"Poker Tracker běží na http://127.0.0.1:{PORT}/  (Ctrl+C pro konec)")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
