"""Tokenless/free prompt gateway for the EVEZ swarm.

This module is intentionally provider-neutral. It turns one natural-language
prompt into a parent task plus independent child tasks, then leaves execution
to local/free workers or optional model adapters. No paid API key is required
for decomposition, routing, evidence collection, contradiction checks, or
witness verification.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import re
from typing import Iterable

from control_plane import ControlPlane, Task


@dataclass(frozen=True)
class PromptPlan:
    parent: Task
    children: tuple[Task, ...]


DEFAULT_ROLES = (
    ("SCOUT", "discover the problem and relevant sources"),
    ("HARVEST", "collect evidence and concrete artifacts"),
    ("CAIN", "look for contradictions, missing assumptions, and failure modes"),
    ("TRUNK", "organize and transform the collected material"),
    ("WITNESS", "audit evidence and verify the result"),
)


def stable_id(prompt: str) -> str:
    digest = hashlib.sha256(prompt.strip().encode("utf-8")).hexdigest()[:16]
    return f"prompt-{digest}"


def _objective(prompt: str, role_goal: str) -> str:
    return f"User request: {prompt.strip()}\nWorker mandate: {role_goal}. Return structured evidence, not unsupported assertions."


def plan_prompt(cp: ControlPlane, prompt: str, *, roles: Iterable[tuple[str, str]] = DEFAULT_ROLES) -> PromptPlan:
    """Create a deterministic fan-out plan from one free-form prompt."""
    clean = re.sub(r"\\s+", " ", prompt).strip()
    if len(clean) < 3:
        raise ValueError("prompt must contain at least three non-whitespace characters")

    parent = cp.create_task(
        title=f"Prompt: {clean[:96]}",
        objective=clean,
        origin="prompt-gateway",
        priority=8,
        required_skills=["prompt-routing", "swarm-orchestration"],
        task_id=stable_id(clean),
    )

    children: list[Task] = []
    for index, (agent, goal) in enumerate(roles, start=1):
        child = cp.create_task(
            title=f"{agent} pass {index}: {clean[:72]}",
            objective=_objective(clean, goal),
            origin=parent.task_id,
            priority=7,
            required_skills=[goal.split(" ", 1)[0].lower(), "evidence-first"],
            task_id=f"{parent.task_id}-{agent.lower()}",
        )
        children.append(child)

    return PromptPlan(parent=parent, children=tuple(children))


def free_mode_contract() -> dict:
    """Describe the capability boundary exposed to a tokenless/free worker pool."""
    return {
        "mode": "free-first",
        "paid_model_keys_required": False,
        "decomposition": "local",
        "routing": "local",
        "verification": "local",
        "optional_model_adapters": True,
        "privileged_actions": "verification_required",
        "unknown_repositories": "observe_only",
    }
