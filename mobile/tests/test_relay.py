#!/usr/bin/env python3
import hashlib
import json
import os
import stat
import tempfile
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "linux"))

import evez_mobile_relay as relay


def request_json(url: str, payload=None, token=None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if token is not None:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=data, headers=headers, method="GET" if payload is None else "POST")
    try:
        with urllib.request.urlopen(req, timeout=3) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def test_http_security_and_digest() -> None:
    old_state = relay.STATE
    old_token = relay.RELAY_TOKEN
    with tempfile.TemporaryDirectory() as tmp:
        relay.STATE = Path(tmp) / "private" / "observations.jsonl"
        server = ThreadingHTTPServer(("127.0.0.1", 0), relay.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{server.server_address[1]}"
        try:
            relay.RELAY_TOKEN = ""
            code, body = request_json(url + "/v1/mobile/observation", {"bad": "payload"})
            assert code == 503 and body["error"] == "write_auth_not_configured"

            relay.RELAY_TOKEN = "test-only-token"
            code, body = request_json(url + "/v1/mobile/observation", {"bad": "payload"})
            assert code == 401 and body["error"] == "unauthorized"

            payload = {"node_id": "test-a16", "created_at": "2026-10-07T00:00:00Z", "sequence": 1}
            envelope = {
                "protocol": "nextclaw/1", "canonicalization": "RFC8785_JCS", "kind": "evidence", "node_id": "test-a16",
                "message_id": "http-test-1", "created_at": payload["created_at"], "payload": payload,
                "digest": hashlib.sha256(relay.canonical(payload)).hexdigest(),
                "evidence_class": "mobile_observation",
            }
            legacy = {key: value for key, value in envelope.items() if key != "canonicalization"}
            code, body = request_json(url + "/v1/mobile/observation", legacy, "test-only-token")
            assert code == 400 and body["error"] == "canonicalization_required"

            tampered = {**envelope, "payload": {**payload, "sequence": 2}}
            code, body = request_json(url + "/v1/mobile/observation", tampered, "test-only-token")
            assert code == 400 and body["error"] == "digest_mismatch"

            mismatch = {**envelope, "node_id": "other-node"}
            code, body = request_json(url + "/v1/mobile/observation", mismatch, "test-only-token")
            assert code == 400 and body["error"] == "node_id_mismatch"

            code, body = request_json(url + "/v1/mobile/observation", envelope, "test-only-token")
            assert code == 202 and body["ok"] is True
            code, body = request_json(url + "/v1/mobile/observation", envelope, "test-only-token")
            assert code == 400 and body["error"] == "duplicate_message_id"
            assert stat.S_IMODE(relay.STATE.stat().st_mode) == 0o600
            print("mobile-relay-http-auth: PASS")
            print("mobile-relay-digest-check: PASS")
            print("mobile-relay-metadata-match: PASS")
            print("mobile-relay-replay-guard: PASS")
            print("mobile-relay-file-permissions: PASS")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)
            relay.STATE = old_state
            relay.RELAY_TOKEN = old_token


def test_jcs_vectors() -> None:
    vector = {"numbers": [333333333.33333329, 1e30, 4.50, 0.002, 1e-27]}
    expected = b'{"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27]}'
    assert relay.canonical(vector) == expected, "RFC 8785 number canonicalization vector failed"
    print("mobile-relay-rfc8785-vector: PASS")


def test_hash_chain_and_digest() -> None:
    payload = {"z": 2, "a": "café", "nested": {"b": True}}
    valid = {"payload": payload, "digest": hashlib.sha256(relay.canonical(payload)).hexdigest()}
    assert relay.valid_digest(valid), "canonical digest should validate"
    tampered = {"payload": {**payload, "z": 3}, "digest": valid["digest"]}
    assert not relay.valid_digest(tampered), "payload mutation must fail digest validation"
    assert not relay.valid_digest({"payload": payload, "digest": "bad"}), "malformed digest must fail"

    with tempfile.TemporaryDirectory() as tmp:
        relay.STATE = Path(tmp) / "observations.jsonl"
        envelopes = [
            {
                "protocol": "nextclaw/1", "kind": "evidence", "node_id": "test-a16",
                "message_id": "test-" + str(i), "created_at": "2026-10-07T00:00:%02dZ" % i,
                "payload": {"sequence": i}, "digest": ("%064x" % i),
                "evidence_class": "mobile_observation",
            } for i in range(12)
        ]
        results = [None] * len(envelopes)
        def worker(index: int) -> None:
            results[index] = relay.store(envelopes[index])
        threads = [threading.Thread(target=worker, args=(i,)) for i in range(len(envelopes))]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        rows = [json.loads(line) for line in relay.STATE.read_text().splitlines()]
        assert len(rows) == len(envelopes)
        assert rows[0]["previous_observation_hash"] == "0" * 64
        for previous, current in zip(rows, rows[1:]):
            assert current["previous_observation_hash"] == previous["observation_hash"]
        hashes = {row["observation_hash"] for row in rows}
        assert len(hashes) == len(rows)
        try:
            relay.store(envelopes[0])
        except ValueError as exc:
            assert str(exc) == "duplicate_message_id"
        else:
            raise AssertionError("duplicate message ID must be rejected")
        print("mobile-relay-chain: PASS")
        print("mobile-relay-canonical-digest: PASS")


if __name__ == "__main__":
    test_jcs_vectors()
    test_hash_chain_and_digest()
    test_http_security_and_digest()
