"""Canonical EVEZ ecosystem registry for swarm routing.

The registry deliberately treats unknown or unverified repositories as
observe-only. A repository becomes executable only after an explicit adapter
and verification policy are added.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

MANIFEST = Path(__file__).with_name("ecosystem_manifest.json")


def load_manifest(path: Path = MANIFEST) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema_version") != "1.0":
        raise ValueError("unsupported ecosystem manifest schema")
    repos = data.get("repositories")
    if not isinstance(repos, list) or not repos:
        raise ValueError("ecosystem manifest has no repositories")
    seen: set[str] = set()
    for item in repos:
        repo = item.get("repo")
        if not isinstance(repo, str) or "/" not in repo:
            raise ValueError(f"invalid repository identity: {repo!r}")
        if repo in seen:
            raise ValueError(f"duplicate repository: {repo}")
        seen.add(repo)
    return data


def by_adapter(adapter: str, manifest: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    data = manifest or load_manifest()
    return [r for r in data["repositories"] if r.get("adapter") == adapter]


def route_for(domain: str, manifest: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    data = manifest or load_manifest()
    return [r for r in data["repositories"] if r.get("domain") == domain]


def summary(manifest: dict[str, Any] | None = None) -> dict[str, Any]:
    data = manifest or load_manifest()
    repos = data["repositories"]
    domains = sorted({r["domain"] for r in repos})
    adapters = sorted({r["adapter"] for r in repos})
    return {
        "repositories": len(repos),
        "domains": len(domains),
        "adapters": adapters,
        "observe_only_unknown": data["integration_policy"]["unknown_repo_behavior"] == "observe_only",
    }


if __name__ == "__main__":
    print(json.dumps(summary(), indent=2, sort_keys=True))
