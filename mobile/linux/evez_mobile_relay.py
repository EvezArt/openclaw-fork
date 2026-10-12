#!/usr/bin/env python3
"""EVEZ mobile relay: authenticated observation storage and mission forwarding only."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

HOST = os.environ.get("EVEZ_MOBILE_RELAY_HOST", "127.0.0.1")
PORT = int(os.environ.get("EVEZ_MOBILE_RELAY_PORT", "8788"))
STATE = Path(os.environ.get("EVEZ_MOBILE_STATE", "state/mobile_observations.jsonl"))
NEXTCLAW = os.environ.get("EVEZ_NEXTCLAW_LOCAL_URL", "http://127.0.0.1:8787/mission")
OPENCLAW = os.environ.get("EVEZ_OPENCLAW_URL", "http://127.0.0.1:18789/")
HERMES = os.environ.get("EVEZ_HERMES_URL", "")
RELAY_TOKEN = os.environ.get("EVEZ_RELAY_TOKEN", "")
MAX_BODY_BYTES = 1024 * 1024
LOCK = threading.Lock()


def canonical(obj: object) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def previous_hash() -> str:
    if not STATE.exists():
        return "0" * 64
    lines = STATE.read_text(encoding="utf-8").splitlines()
    if not lines:
        return "0" * 64
    try:
        return json.loads(lines[-1]).get("observation_hash", "0" * 64)
    except (json.JSONDecodeError, AttributeError):
        return "0" * 64


def store(envelope: dict) -> dict:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    with LOCK:
        message_id = envelope.get("message_id")
        if isinstance(message_id, str) and STATE.exists():
            # Durable replay check: the append-only ledger is authoritative across restarts.
            with STATE.open("r", encoding="utf-8") as existing:
                for line in existing:
                    try:
                        old = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    old_envelope = old.get("envelope", {})
                    if isinstance(old_envelope, dict) and old_envelope.get("message_id") == message_id:
                        raise ValueError("duplicate_message_id")
        record = {
            "received_at": now(),
            "previous_observation_hash": previous_hash(),
            "envelope": envelope,
        }
        record["observation_hash"] = hashlib.sha256(canonical(record)).hexdigest()
        with STATE.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, sort_keys=True, ensure_ascii=False) + "\n")
    return {
        "stored": True,
        "observation_hash": record["observation_hash"],
        "previous_observation_hash": record["previous_observation_hash"],
    }


def forward(payload: dict) -> tuple[int, dict]:
    request = Request(NEXTCLAW, data=canonical(payload), headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(request, timeout=15) as response:
            data = response.read(MAX_BODY_BYTES + 1)
            if len(data) > MAX_BODY_BYTES:
                return 502, {"ok": False, "error": "upstream_response_too_large"}
            try:
                return response.status, json.loads(data.decode("utf-8") or "{}")
            except (UnicodeDecodeError, json.JSONDecodeError):
                return 502, {"ok": False, "error": "invalid_upstream_json"}
    except HTTPError as exc:
        return 502, {"ok": False, "error": "upstream_http_error", "status": exc.code}
    except (URLError, TimeoutError):
        return 502, {"ok": False, "error": "upstream_unavailable"}


def valid_digest(envelope: dict) -> bool:
    payload = envelope.get("payload")
    digest = envelope.get("digest")
    if not isinstance(payload, dict) or not isinstance(digest, str):
        return False
    if len(digest) != 64 or any(ch not in "0123456789abcdef" for ch in digest):
        return False
    return hmac.compare_digest(hashlib.sha256(canonical(payload)).hexdigest(), digest)


class Handler(BaseHTTPRequestHandler):
    server_version = "EVEZMobileRelay/1"

    def reply(self, status: int, payload: dict) -> None:
        body = canonical(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def authorized(self) -> bool:
        if not RELAY_TOKEN:
            return False
        supplied = self.headers.get("Authorization", "")
        prefix = "Bearer "
        return supplied.startswith(prefix) and hmac.compare_digest(supplied[len(prefix):], RELAY_TOKEN)

    def read_json(self) -> dict:
        raw_length = self.headers.get("Content-Length", "")
        try:
            size = int(raw_length)
        except (TypeError, ValueError):
            raise ValueError("content_length_required") from None
        if size <= 0 or size > MAX_BODY_BYTES:
            raise ValueError("body_size_invalid")
        if self.headers.get("Transfer-Encoding"):
            raise ValueError("transfer_encoding_not_supported")
        if "application/json" not in self.headers.get("Content-Type", "").lower():
            raise ValueError("application_json_required")
        raw = self.rfile.read(size)
        if len(raw) != size:
            raise ValueError("body_truncated")
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("invalid_json") from None
        if not isinstance(payload, dict):
            raise ValueError("json_object_required")
        return payload

    def do_GET(self) -> None:
        if self.path == "/health":
            self.reply(200, {
                "ok": True, "service": "evez-mobile-relay",
                "mission_upstream_configured": bool(NEXTCLAW),
                "openclaw_url_configured": bool(OPENCLAW),
                "hermes_url_configured": bool(HERMES),
                "write_auth_configured": bool(RELAY_TOKEN),
            })
            return
        if self.path == "/v1/control":
            self.reply(200, {"ok": True, "policy": {
                "mission": True, "arbitrary_shell": False, "secret_access": False,
                "deployment": "verification_gated", "writes_require_bearer_auth": True,
                "observation_digest_validation": True, "durable_message_id_replay_check": True,
                "max_request_bytes": MAX_BODY_BYTES,
            }})
            return
        self.reply(404, {"ok": False, "error": "not_found"})

    def do_POST(self) -> None:
        if self.path not in ("/v1/mobile/observation", "/v1/mission"):
            self.reply(404, {"ok": False, "error": "not_found"})
            return
        if not self.authorized():
            self.reply(503 if not RELAY_TOKEN else 401, {
                "ok": False, "error": "write_auth_not_configured" if not RELAY_TOKEN else "unauthorized",
            })
            return
        try:
            payload = self.read_json()
            if self.path == "/v1/mobile/observation":
                if payload.get("protocol") != "nextclaw/1":
                    raise ValueError("unsupported_protocol")
                if payload.get("kind") != "evidence":
                    raise ValueError("evidence_envelope_required")
                if payload.get("evidence_class") != "mobile_observation":
                    raise ValueError("mobile_observation_class_required")
                if not isinstance(payload.get("message_id"), str) or not payload["message_id"].strip():
                    raise ValueError("message_id_required")
                if not valid_digest(payload):
                    raise ValueError("digest_mismatch")
                self.reply(202, {"ok": True, **store(payload)})
                return
            if not isinstance(payload.get("prompt"), str) or not payload["prompt"].strip():
                raise ValueError("prompt_required")
            if len(payload["prompt"]) > 8000:
                raise ValueError("prompt_too_large")
            status, result = forward(payload)
            self.reply(status, result)
        except ValueError as exc:
            self.reply(400, {"ok": False, "error": str(exc)})

    def log_message(self, format: str, *args: object) -> None:
        # Avoid request bodies, query strings, and auth material in routine logs.
        super().log_message("%s %s", self.command, self.path.split("?", 1)[0])


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
