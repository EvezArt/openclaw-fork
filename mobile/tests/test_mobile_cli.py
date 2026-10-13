#!/usr/bin/env python3
"""Regression tests for the read-only evezctl mesh probe output."""

import os
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        statuses = {
            "/health": 503,
            "/ruview/health": 200,
            "/ruview/api/v1/nodes": 403,
            "/openclaw": 401,
            "/hermes/": 200,
        }
        status = statuses.get(self.path, 404)
        body = b'{"debug":"SENSITIVE_RESPONSE_SENTINEL"}'
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    script = Path(__file__).resolve().parents[1] / "termux" / "evezctl"
    try:
        with tempfile.TemporaryDirectory() as home:
            env = os.environ.copy()
            env.update({
                "HOME": home,
                "EVEZ_NODE_ID": "test-node",
                "EVEZ_OBSERVATION_URL": base + "/v1/mobile/observation",
                "EVEZ_NEXTCLAW_URL": base + "/v1/mission",
                "EVEZ_OPENCLAW_URL": base + "/openclaw",
                "EVEZ_HERMES_URL": base + "/hermes/",
                "EVEZ_RUVIEW_URL": base + "/ruview",
                "EVEZ_RELAY_TOKEN": "TEST_ONLY_SECRET_DO_NOT_PRINT",
            })
            result = subprocess.run(
                ["bash", str(script), "mesh"],
                env=env,
                capture_output=True,
                text=True,
                check=True,
                timeout=20,
            )
            expected = {
                "relay_health=upstream_error",
                "ruview_health=ok",
                "ruview_nodes=reachable_auth_required",
                "openclaw_ui=reachable_auth_required",
                "hermes_ui=ok",
            }
            lines = set(result.stdout.splitlines())
            missing = expected - lines
            assert not missing, f"missing expected statuses: {sorted(missing)}; stdout={result.stdout!r}"
            assert "TEST_ONLY_SECRET_DO_NOT_PRINT" not in result.stdout
            assert "SENSITIVE_RESPONSE_SENTINEL" not in result.stdout
            assert base not in result.stdout
            assert not result.stderr, f"unexpected stderr: {result.stderr!r}"
            print("evezctl-mesh-status-categories: PASS")
            print("evezctl-mesh-redacts-body-url-and-token: PASS")
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


if __name__ == "__main__":
    main()
