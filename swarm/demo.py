"""Run a repository-wide EVEZ swarm demonstration without executing privileged actions."""
from __future__ import annotations

import json
from pathlib import Path
from control_plane import ControlPlane

ROOT = Path(__file__).resolve().parent


def main() -> int:
    manifest = json.loads((ROOT / "ecosystem_manifest.json").read_text(encoding="utf-8"))
    cp = ControlPlane("state/swarm-demo.db")

    for agent in json.loads((ROOT / "agents.json").read_text(encoding="utf-8"))["agents"]:
        cp.register_agent(agent["id"], agent["role"])
        cp.heartbeat(agent["id"])

    task = cp.create_task(
        "EVEZ ecosystem integration demonstration",
        "Trace one non-privileged research task through repository discovery, evidence collection, contradiction checking, witness verification, and completion.",
        priority=100,
        origin="demo",
        required_skills=["research", "verification", "cross-repo-orchestration"],
    )
    cp.claim_next("SPINE", lease_seconds=300)
    cp.transition(task.task_id, "running", "SPINE")

    sources = [r for r in manifest["repositories"] if r["adapter"] in {"evidence_source", "event_source", "telemetry"}]
    for repo in sources[:8]:
        cp.add_evidence(task.task_id, "HARVEST", {
            "type": "repository_source",
            "repository": repo["repo"],
            "domain": repo["domain"],
            "adapter": repo["adapter"],
            "mode": "observe_only",
        })

    cp.add_evidence(task.task_id, "SCOUT", {
        "type": "ecosystem_inventory",
        "repository_count": len(manifest["repositories"]),
        "schema_version": manifest["schema_version"],
    })
    cp.add_evidence(task.task_id, "CAIN", {
        "type": "contradiction_check",
        "result": "demo_pass",
        "privileged_actions_executed": False,
    })
    cp.transition(task.task_id, "verifying", "WITNESS")
    completed = cp.verify(task.task_id, "WITNESS", "verified", "Repository-wide non-privileged integration trace completed.")

    print(json.dumps({
        "task_id": completed.task_id,
        "state": completed.state,
        "repositories_available": len(manifest["repositories"]),
        "evidence_sources_sampled": min(8, len(sources)),
        "privileged_actions_executed": False,
        "next_integration": "connect OpenClaw and AgentNet dispatchers to ControlPlane",
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
