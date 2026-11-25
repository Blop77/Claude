"""Run SastiDawa locally: serves frontend/ and routes /api/* to the Lambda handler.

    python3 scripts/dev_server.py            # http://localhost:8000
    USE_TEXTRACT=1 python3 scripts/dev_server.py   # real OCR (needs AWS creds + boto3)

Photo OCR is disabled by default locally so nothing calls AWS by accident.
Sharing needs DynamoDB, so it returns a clear 503 locally.
"""
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
if os.environ.get("USE_TEXTRACT") != "1":
    os.environ["OCR_DISABLED"] = "1"

import app  # noqa: E402


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT / "frontend"), **kw)

    def _api(self, method):
        url = urlsplit(self.path)
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length).decode() if length else ""
        event = {"rawPath": url.path, "body": raw,
                 "queryStringParameters": dict(parse_qsl(url.query)),
                 "requestContext": {"http": {"method": method}}}
        resp = app.lambda_handler(event, None)
        body = resp["body"].encode()
        self.send_response(resp["statusCode"])
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._api("GET")
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            return self._api("POST")
        self.send_error(404)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    print(f"SastiDawa dev server on http://localhost:{port}  (OCR {'ON' if os.environ.get('OCR_DISABLED') != '1' else 'off'})")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
