"""AWS Lambda entry point for MedLens (API Gateway HTTP API, payload v2).

Routes
    POST /api/extract   {"image_base64": "..."}         -> OCR (Textract) + match
    POST /api/match     {"text": "..."} or {"items": []} -> match only
    POST /api/speak     {"text": "...", "lang": "hi"|"en"}  -> Polly MP3 (base64)
    GET  /api/kendras?pincode=411038                     -> nearest Kendras
    POST /api/share     {analysis}                       -> saves list, returns id
    GET  /api/share/{id}                                 -> saved list

The same handler runs locally through scripts/dev_server.py.
"""
from __future__ import annotations

import base64
import json
import math
import os
import secrets
import time
from decimal import Decimal
from pathlib import Path

from explain import MedicineInfo
from matcher import Catalog, parse_lines

_DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent / "data"))
if not _DATA_DIR.exists():  # local dev: data/ lives at repo root
    _DATA_DIR = Path(__file__).resolve().parent.parent / "data"

INFO = MedicineInfo(json.loads((_DATA_DIR / "medicine_info.json").read_text()))
CATALOG = Catalog(json.loads((_DATA_DIR / "catalog.json").read_text()), INFO)
KENDRAS = json.loads((_DATA_DIR / "kendras.json").read_text())

SHARE_TABLE = os.environ.get("SHARE_TABLE")  # DynamoDB table; unset locally
SHARE_TTL_DAYS = 30
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # Textract sync limit for image bytes

_textract = None
_table = None
_polly = None

# Amazon Polly voices, tried in order (neural first, standard as fallback).
# Polly has no Marathi voice, so Marathi is text-only.
POLLY_VOICES = {
    "hi": [("Kajal", "hi-IN", "neural"), ("Aditi", "hi-IN", "standard")],
    "en": [("Kajal", "en-IN", "neural"), ("Aditi", "en-IN", "standard")],
}
MAX_SPEAK_CHARS = 1500


def _get_textract():
    global _textract
    if _textract is None:
        import boto3  # available in the Lambda runtime
        _textract = boto3.client("textract")
    return _textract


def _get_polly():
    global _polly
    if _polly is None:
        import boto3
        _polly = boto3.client("polly")
    return _polly


def _get_table():
    global _table
    if _table is None:
        import boto3
        _table = boto3.resource("dynamodb").Table(SHARE_TABLE)
    return _table


# --------------------------------------------------------------------------
# Handlers
# --------------------------------------------------------------------------

def extract(body: dict) -> tuple[int, dict]:
    b64 = body.get("image_base64") or ""
    if "," in b64[:100]:  # strip data-URL prefix
        b64 = b64.split(",", 1)[1]
    try:
        image = base64.b64decode(b64, validate=True)
    except Exception:
        return 400, {"error": "Image could not be read. Please upload a JPG or PNG."}
    if not image:
        return 400, {"error": "No image received."}
    if len(image) > MAX_IMAGE_BYTES:
        return 413, {"error": "Image is larger than 5 MB. Please use a smaller photo."}
    if os.environ.get("OCR_DISABLED") == "1":
        return 503, {"error": "Photo reading is not available in local mode. Type the medicines instead."}
    try:
        resp = _get_textract().detect_document_text(Document={"Bytes": image})
    except Exception as exc:  # surface a readable message, log the detail
        print(f"textract error: {exc!r}")
        return 502, {"error": "Could not read the prescription photo. Try a clearer photo or type the medicines.",
                     "code": _aws_code(exc)}
    lines = [b["Text"] for b in resp.get("Blocks", []) if b.get("BlockType") == "LINE"]
    text = "\n".join(lines)
    result = CATALOG.analyse(parse_lines(text))
    result["ocr_text"] = text
    # Only lines that matched a brand are worth showing; keep the rest for review.
    return 200, result


def match(body: dict) -> tuple[int, dict]:
    if body.get("items"):
        items = [
            {"raw": str(i.get("raw") or i.get("query", ""))[:200], "query": str(i.get("query", ""))[:120],
             "units": int(i.get("units") or 30),
             "schedule": _schedule(i.get("schedule")), "days": _int_or_none(i.get("days"))}
            for i in body["items"][:40] if i.get("query")
        ]
    else:
        text = str(body.get("text") or "")[:5000]
        items = parse_lines(text)
    if not items:
        return 400, {"error": "No medicines found. Write one medicine per line."}
    return 200, CATALOG.analyse(items)


def speak(body: dict) -> tuple[int, dict]:
    lang = body.get("lang")
    text = str(body.get("text") or "").strip()
    if lang not in POLLY_VOICES:
        return 400, {"error": "Audio is available in English and Hindi only."}
    if not text:
        return 400, {"error": "Nothing to read aloud."}
    if os.environ.get("OCR_DISABLED") == "1":  # local mode: no AWS calls
        return 503, {"error": "Audio needs the AWS deployment."}
    last_code = None
    for voice, code, engine in POLLY_VOICES[lang]:
        try:
            resp = _get_polly().synthesize_speech(Text=text[:MAX_SPEAK_CHARS], VoiceId=voice, LanguageCode=code,
                                                  Engine=engine, OutputFormat="mp3")
            return 200, {"audio_base64": base64.b64encode(resp["AudioStream"].read()).decode(), "voice": voice}
        except Exception as exc:
            last_code = _aws_code(exc)
            print(f"polly error ({voice}/{engine}): {exc!r}")
    return 502, {"error": "Could not create audio right now.", "code": last_code}


def kendras(params: dict) -> tuple[int, dict]:
    pincode = (params.get("pincode") or "").strip()
    lat, lon = params.get("lat"), params.get("lon")
    rows = KENDRAS["kendras"]
    if lat and lon:
        try:
            la, lo = float(lat), float(lon)
        except ValueError:
            return 400, {"error": "Invalid location."}
        ranked = sorted(rows, key=lambda k: _km(la, lo, k["lat"], k["lon"]))
        out = [dict(k, distance_km=round(_km(la, lo, k["lat"], k["lon"]), 1)) for k in ranked[:3]]
    elif pincode.isdigit() and len(pincode) == 6:
        # Same pincode first, then same 3-digit postal district prefix.
        same = [k for k in rows if k["pincode"] == pincode]
        near = [k for k in rows if k["pincode"][:3] == pincode[:3] and k not in same]
        out = (same + near)[:3]
    else:
        return 400, {"error": "Enter a 6-digit pincode or allow location access."}
    return 200, {"kendras": out, "is_sample_data": bool(KENDRAS["meta"].get("is_sample")),
                 "data_notice": KENDRAS["meta"].get("notice")}


def share_create(body: dict) -> tuple[int, dict]:
    if not SHARE_TABLE:
        return 503, {"error": "Sharing needs the AWS deployment (DynamoDB)."}
    items = body.get("items")
    if not isinstance(items, list) or not items:
        return 400, {"error": "Nothing to share."}
    # Store only what's needed to show the list: no photo, no OCR text.
    slim = [{
        "query": str(i.get("query", ""))[:120],
        "units": int(i.get("units") or 0),
        "brand": (i.get("brand") or {}).get("brand"),
        "generic": (i.get("generic") or {}).get("name"),
        "generic_code": (i.get("generic") or {}).get("code"),
        "monthly_saving": i.get("monthly_saving"),
        "status": i.get("status"),
    } for i in items[:40]]
    share_id = secrets.token_urlsafe(6)
    record = {"id": share_id, "items": slim, "summary": body.get("summary") or {},
              "created": int(time.time()), "expires": int(time.time()) + SHARE_TTL_DAYS * 86400}
    _get_table().put_item(Item=json.loads(json.dumps(record), parse_float=Decimal))
    return 200, {"id": share_id}


def share_get(share_id: str) -> tuple[int, dict]:
    if not SHARE_TABLE:
        return 503, {"error": "Sharing needs the AWS deployment (DynamoDB)."}
    item = _get_table().get_item(Key={"id": share_id}).get("Item")
    if not item:
        return 404, {"error": "This list has expired or does not exist."}
    return 200, json.loads(json.dumps(item, default=_decimal))


# --------------------------------------------------------------------------
# Routing
# --------------------------------------------------------------------------

def route(method: str, path: str, body: dict, params: dict) -> tuple[int, dict]:
    path = path.rstrip("/")
    if method == "POST" and path == "/api/extract":
        return extract(body)
    if method == "POST" and path == "/api/match":
        return match(body)
    if method == "POST" and path == "/api/speak":
        return speak(body)
    if method == "GET" and path == "/api/kendras":
        return kendras(params)
    if method == "POST" and path == "/api/share":
        return share_create(body)
    if method == "GET" and path.startswith("/api/share/"):
        return share_get(path.rsplit("/", 1)[1])
    if method == "GET" and path == "/api/health":
        return 200, {"ok": True, "sample_data": CATALOG.meta.get("is_sample", False),
                     "medicines_explained": len(INFO.salts), "info_reviewed": bool(INFO.meta.get("reviewed")),
                     "brands": len(CATALOG.brands), "generics": len(CATALOG.generics)}
    return 404, {"error": "Not found"}


def lambda_handler(event, _context):
    http = event.get("requestContext", {}).get("http", {})
    method = http.get("method", "GET")
    path = event.get("rawPath", "/")
    raw = event.get("body") or ""
    if event.get("isBase64Encoded") and raw:
        raw = base64.b64decode(raw).decode("utf-8", "replace")
    try:
        body = json.loads(raw) if raw else {}
        if not isinstance(body, dict):
            raise ValueError
    except ValueError:
        return _resp(400, {"error": "Request body must be a JSON object."})
    try:
        status, payload = route(method, path, body, event.get("queryStringParameters") or {})
    except Exception as exc:
        print(f"unhandled error: {exc!r}")
        status, payload = 500, {"error": "Something went wrong. Please try again."}
    return _resp(status, payload)


def _resp(status: int, payload: dict) -> dict:
    return {"statusCode": status, "headers": {"content-type": "application/json"},
            "body": json.dumps(payload)}


def _km(la1, lo1, la2, lo2) -> float:
    p1, p2 = math.radians(la1), math.radians(la2)
    dp, dl = p2 - p1, math.radians(lo2 - lo1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


def _aws_code(exc) -> str:
    """AWS error code only (e.g. 'AccessDeniedException') - no account details."""
    try:
        return exc.response["Error"]["Code"]
    except Exception:
        return type(exc).__name__


def _schedule(v):
    if isinstance(v, list) and len(v) == 3 and all(isinstance(x, int) and 0 <= x <= 2 for x in v):
        return v
    return None


def _int_or_none(v):
    try:
        return int(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _decimal(o):
    if isinstance(o, Decimal):
        return int(o) if o == o.to_integral_value() else float(o)
    raise TypeError
