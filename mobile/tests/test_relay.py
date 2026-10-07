#!/usr/bin/env python3
import json
import tempfile
import threading
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "linux"))

import evez_mobile_relay as relay


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        relay.STATE = Path(tmp) / "mobile_observations.jsonl"

        envelopes = [
            {
                "protocol": "nextclaw/1",
                "kind": "evidence",
                "node_id": "test-a16",
                "message_id": "test-" + str(i),
                "created_at": "2026-10-07T00:00:%02dZ" % i,
                "payload": {"sequence": i},
                "digest": ("%064x" % i),
                "evidence_class": "mobile_observation",
            }
            for i in range(12)
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
        print("mobile-relay-chain: PASS")


if __name__ == "__main__":
    main()
