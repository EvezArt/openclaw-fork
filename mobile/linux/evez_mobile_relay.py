#!/usr/bin/env python3
"""EVEZ mobile relay: observation storage and mission forwarding only."""

from __future__ import annotations

import hashlib
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
HERMES = os.environ.get("EVEZ_HERMES_URL", "http://127.0.0.1:18790/")
LOCK = threading.Lock()


def canonical(obj: object) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


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
    except json.JSONDecodeError:
        return "0" * 64


def store(envelope: dict) -> dict:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "received_at": now(),
        "previous_observation_hash": previous_hash(),
        "envelope": envelope,
    }
    record["observation_hash"] = hashlib.sha256(canonical(record)).hexdigest()
    with LOCK:
        with STATE.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, sort_keys=True) + "\n")
    return {
        "stored": True,
        "observation_hash": record["observation_hash"],
        "previous_observation_hash": record["previous_observation_hash"],
    }


def forward(payload: dict) -> tuple[int, dict]:
    request = Request(
        NEXTCLAW,
        data=canonical(payload),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=15) as response:
            data = response.read().decode("utf-8")
            return response.status, json.loads(data or "{}")
    except (HTTPError, URLError, TimeoutError) as exc:
        return 502, {"ok": False, "error": str(exc)}


class Handler(BaseHTTPRequestHandler):
    server_version = "EVEZMobileRelay/1"

    def reply(self, status: int, payload: dict) -> None:
        body = canonical(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        size = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(size).decode("utf-8"))

    def do_GET(self) -> None:
        if self.path == "/health":
            self.reply(200, {
                "ok": True,
                "service": "evez-mobile-relay",
                "nextclaw": NEXTCLAW,
                "openclaw": OPENCLAW,
                "hermes": HERMES,
            })
            return

        if self.path == "/v1/control":
            self.reply(200, {
                "ok": True,
                "policy": {
                    "mission": True,
                    "arbitrary_shell": False,
                    "secret_access": False,
                    "deployment": "verification_gated",
                },
                "urls": {
                    "nextclaw": NEXTCLAW,
                    "openclaw": OPENCLAW,
                    "hermes": HERMES,
                },
            })
            return

        self.reply(404, {"ok": False, "error": "not_found"})

    def do_POST(self) -> None:
        if self.path == "/v1/mobile/observation":
            try:
                payload = self.read_json()
                if payload.get("protocol") != "nextclaw/1":
                    raise ValueError("unsupported protocol")
                if payload.get("kind") != "evidence":
                    raise ValueError("observation must use evidence envelope")
                self.reply(202, {"ok": True, **store(payload)})
            except (ValueError, json.JSONDecodeError) as exc:
                self.reply(400, {"ok": False, "error": str(exc)})
            return

        if self.path == "/v1/mission":
            try:
                payload = self.read_json()
                if not str(payload.get("prompt", "")).strip():
                    raise ValueError("prompt is required")
                status, result = forward(payload)
                self.reply(status, result)
            except (ValueError, json.JSONDecodeError) as exc:
                self.reply(400, {"ok": False, "error": str(exc)})
            return

        self.reply(404, {"ok": False, "error": "not_found"})


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
