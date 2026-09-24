"""Deterministic smoke checks for the EVEZ swarm foundation."""
from __future__ import annotations

import json
from pathlib import Path

from control_plane import ControlPlane
from ecosystem import load_manifest, summary

ROOT = Path(__file__).resolve().parent
AGENTS = ROOT / "agents.json"


def main() -> int:
    manifest = json.loads(AGENTS.read_text(encoding="utf-8"))
    ids = [a["id"] for a in manifest["agents"]]
    required = [a["id"] for a in manifest["agents"] if a.get("required")]
    errors: list[str] = []

    if manifest.get("orchestrator") not in ids:
        errors.append("orchestrator is not in agent roster")
    if len(ids) != len(set(ids)):
        errors.append("duplicate agent ids")
    if not required:
        errors.append("no required agents configured")

    try:
        ecosystem = load_manifest()
        ecosystem_status = summary(ecosystem)
        if ecosystem_status["repositories"] < 8:
            errors.append("ecosystem registry unexpectedly small")
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        ecosystem_status = {"error": str(exc)}
        errors.append(f"ecosystem manifest invalid: {exc}")

    cp = ControlPlane("state/swarm-smoke.db")
    for agent in manifest["agents"]:
        cp.register_agent(agent["id"], agent["role"])
        cp.heartbeat(agent["id"])

    task = cp.create_task(
        "swarm smoke test",
        "verify task lifecycle, lease handling, verification gate, and ecosystem registry",
        priority=10,
        required_skills=["swarm-control-plane"],
    )
    claimed = cp.claim_next("SPINE", lease_seconds=60)
    if not claimed or claimed.task_id != task.task_id:
        errors.append("task claim failed")
    else:
        cp.transition(task.task_id, "running", "SPINE")
        cp.add_evidence(task.task_id, "HARVEST", {"type": "smoke_test", "source": "local"})
        cp.transition(task.task_id, "verifying", "WITNESS")
        verified = cp.verify(task.task_id, "WITNESS", "verified", "deterministic smoke test")
        if verified.state != "completed":
            errors.append("verification did not complete task")

    status = cp.status()
    if status["live_agents"] != len(ids):
        errors.append("heartbeat accounting mismatch")

    print(json.dumps({
        "ok": not errors,
        "errors": errors,
        "status": status,
        "ecosystem": ecosystem_status,
    }, indent=2, sort_keys=True))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
