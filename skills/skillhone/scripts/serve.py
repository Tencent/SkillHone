#!/usr/bin/env python3
"""Webhook listener for Forgejo events.

Usage:
    python3 scripts/serve.py --port 8790
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import logging
import sys
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

logger = logging.getLogger("skillhone.serve")


class WebhookHandler(BaseHTTPRequestHandler):
    server: "WebhookServer"

    def log_message(self, format, *args):
        logger.info(f"[webhook] {format % args}")

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        # Verify signature
        secret = self.server.webhook_secret
        if secret:
            sig = self.headers.get("X-Forgejo-Signature", "")
            expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(sig, expected):
                self.send_response(401)
                self.end_headers()
                return

        event = self.headers.get("X-Forgejo-Event", "unknown")
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"Invalid JSON")
            return

        action = payload.get("action", "")
        repo = payload.get("repository", {}).get("full_name", "")
        logger.info(f"Event: {event}/{action} on {repo}")

        if event == "pull_request" and action in ("opened", "synchronize"):
            pr = payload.get("pull_request", {})
            logger.info(f"PR #{pr.get('number')}: {pr.get('title')}")
        elif event == "issues" and action == "opened":
            issue = payload.get("issue", {})
            logger.info(f"Issue #{issue.get('number')}: {issue.get('title')}")
        elif event == "push":
            ref = payload.get("ref", "")
            logger.info(f"Push to {ref}")

        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"OK")


class WebhookServer(HTTPServer):
    webhook_secret: str | None = None


def main() -> int:
    parser = argparse.ArgumentParser(description="Forgejo webhook listener")
    parser.add_argument("--port", type=int, default=8790)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--secret", default=None)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(message)s")

    server = WebhookServer((args.host, args.port), WebhookHandler)
    server.webhook_secret = args.secret

    print(f"Listening on {args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
