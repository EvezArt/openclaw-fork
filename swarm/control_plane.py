"""EVEZ Swarm control plane.

A dependency-light, transactional substrate for coordinating agents without
requiring a separate service. SQLite is used deliberately: the existing EVEZ
components already target small/mobile environments, and this gives the swarm
one authoritative state store before introducing distributed infrastructure.

State model:
  tasks   = current work
  events  = append-only history
  agents  = liveness + lease ownership

The control plane does not execute arbitrary commands. Agents claim work with
leases, publish structured results, and move tasks through explicit states.
"""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

SCHEMA_VERSION = 1
DEFAULT_DB = Path("state/swarm.db")

TASK_STATES = {
    "queued",
    "leased",
    "running",
    "verifying",
    "completed",
    "blocked",
    "failed",
    "cancelled",
}

TERMINAL_STATES = {"completed", "cancelled"}

ALLOWED_TRANSITIONS = {
    "queued": {"leased", "cancelled"},
    "leased": {"running", "queued", "blocked", "failed", "cancelled"},
    "running": {"verifying", "completed", "blocked", "failed", "cancelled"},
    "verifying": {"completed", "blocked", "failed"},
    "blocked": {"queued", "cancelled"},
    "failed": {"queued", "cancelled"},
    "completed": set(),
    "cancelled": set(),
}


@dataclass(frozen=True)
class Task:
    task_id: str
    title: str
    objective: str
    origin: str = "user"
    priority: int = 5
    state: str = "queued"
    assigned_agent: str | None = None
    required_skills: tuple[str, ...] = ()
    evidence: tuple[dict[str, Any], ...] = ()
    result: dict[str, Any] | None = None
    verification: str = "unverified"


@dataclass(frozen=True)
class Event:
    event_id: str
    event_type: str
    actor: str
    payload: dict[str, Any]
    created_at: str


class ControlPlane:
    """Single-writer-safe coordination store for the EVEZ swarm."""

    def __init__(self, db_path: str | Path = DEFAULT_DB) -> None:
        self.path = Path(db_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=30000")
        try:
            yield conn
        finally:
            conn.close()

    def _init_db(self) -> None:
        with self._connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS agents (
                    agent_id TEXT PRIMARY KEY,
                    role TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'offline',
                    capabilities_json TEXT NOT NULL DEFAULT '[]',
                    last_heartbeat REAL NOT NULL DEFAULT 0,
                    metadata_json TEXT NOT NULL DEFAULT '{}'
                );

                CREATE TABLE IF NOT EXISTS tasks (
                    task_id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    objective TEXT NOT NULL,
                    origin TEXT NOT NULL,
                    priority INTEGER NOT NULL DEFAULT 5,
                    state TEXT NOT NULL,
                    assigned_agent TEXT,
                    lease_until REAL,
                    required_skills_json TEXT NOT NULL DEFAULT '[]',
                    evidence_json TEXT NOT NULL DEFAULT '[]',
                    result_json TEXT,
                    verification TEXT NOT NULL DEFAULT 'unverified',
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    FOREIGN KEY (assigned_agent) REFERENCES agents(agent_id)
                );

                CREATE INDEX IF NOT EXISTS idx_tasks_queue
                    ON tasks(state, priority DESC, created_at ASC);
                CREATE INDEX IF NOT EXISTS idx_tasks_lease
                    ON tasks(lease_until);

                CREATE TABLE IF NOT EXISTS events (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id TEXT NOT NULL UNIQUE,
                    event_type TEXT NOT NULL,
                    actor TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                INSERT OR IGNORE INTO meta(key, value)
                    VALUES ('schema_version', '1');
                """
            )

    @staticmethod
    def now() -> float:
        return time.time()

    @staticmethod
    def iso_now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def emit(self, event_type: str, actor: str, payload: dict[str, Any]) -> Event:
        event = Event(
            event_id=uuid.uuid4().hex,
            event_type=event_type,
            actor=actor,
            payload=payload,
            created_at=self.iso_now(),
        )
        with self._connect() as db:
            db.execute(
                "INSERT INTO events(event_id,event_type,actor,payload_json,created_at) VALUES(?,?,?,?,?)",
                (event.event_id, event.event_type, event.actor, json.dumps(event.payload), event.created_at),
            )
        return event

    def register_agent(
        self,
        agent_id: str,
        role: str,
        capabilities: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        with self._connect() as db:
            db.execute(
                """
                INSERT INTO agents(agent_id,role,status,capabilities_json,last_heartbeat,metadata_json)
                VALUES(?,?,?,?,?,?)
                ON CONFLICT(agent_id) DO UPDATE SET
                    role=excluded.role,
                    capabilities_json=excluded.capabilities_json,
                    metadata_json=excluded.metadata_json
                """,
                (
                    agent_id,
                    role,
                    "offline",
                    json.dumps(capabilities or []),
                    0,
                    json.dumps(metadata or {}),
                ),
            )
        self.emit("agent.registered", agent_id, {"role": role, "capabilities": capabilities or []})

    def heartbeat(self, agent_id: str, status: str = "online", metadata: dict[str, Any] | None = None) -> None:
        now = self.now()
        with self._connect() as db:
            row = db.execute("SELECT agent_id FROM agents WHERE agent_id=?", (agent_id,)).fetchone()
            if row is None:
                raise KeyError(f"Unknown agent: {agent_id}")
            db.execute(
                "UPDATE agents SET status=?, last_heartbeat=?, metadata_json=COALESCE(?, metadata_json) WHERE agent_id=?",
                (status, now, json.dumps(metadata) if metadata is not None else None, agent_id),
            )
        self.emit("agent.heartbeat", agent_id, {"status": status})

    def create_task(
        self,
        title: str,
        objective: str,
        *,
        origin: str = "user",
        priority: int = 5,
        required_skills: list[str] | None = None,
        task_id: str | None = None,
    ) -> Task:
        if not title.strip() or not objective.strip():
            raise ValueError("title and objective are required")
        if not 0 <= priority <= 10:
            raise ValueError("priority must be 0..10")
        task = Task(
            task_id=task_id or f"task-{uuid.uuid4().hex[:12]}",
            title=title.strip(),
            objective=objective.strip(),
            origin=origin,
            priority=priority,
            required_skills=tuple(required_skills or []),
        )
        now = self.now()
        with self._connect() as db:
            db.execute(
                """
                INSERT INTO tasks(
                    task_id,title,objective,origin,priority,state,required_skills_json,
                    evidence_json,verification,created_at,updated_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    task.task_id,
                    task.title,
                    task.objective,
                    task.origin,
                    task.priority,
                    task.state,
                    json.dumps(list(task.required_skills)),
                    "[]",
                    task.verification,
                    now,
                    now,
                ),
            )
        self.emit("task.created", "control-plane", asdict(task))
        return task

    def reap_expired_leases(self) -> int:
        now = self.now()
        with self._connect() as db:
            rows = db.execute(
                "SELECT task_id FROM tasks WHERE state IN ('leased','running') AND lease_until IS NOT NULL AND lease_until < ?",
                (now,),
            ).fetchall()
            for row in rows:
                db.execute(
                    "UPDATE tasks SET state='queued', assigned_agent=NULL, lease_until=NULL, updated_at=? WHERE task_id=?",
                    (now, row["task_id"]),
                )
        if rows:
            self.emit("task.leases_reaped", "control-plane", {"count": len(rows)})
        return len(rows)

    def claim_next(self, agent_id: str, lease_seconds: int = 300) -> Task | None:
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive")
        now = self.now()
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            agent = db.execute("SELECT agent_id FROM agents WHERE agent_id=?", (agent_id,)).fetchone()
            if agent is None:
                db.execute("ROLLBACK")
                raise KeyError(f"Unknown agent: {agent_id}")
            db.execute(
                "UPDATE tasks SET state='queued', assigned_agent=NULL, lease_until=NULL WHERE state IN ('leased','running') AND lease_until < ?",
                (now,),
            )
            row = db.execute(
                "SELECT * FROM tasks WHERE state='queued' ORDER BY priority DESC, created_at ASC LIMIT 1"
            ).fetchone()
            if row is None:
                db.execute("COMMIT")
                return None
            lease_until = now + lease_seconds
            db.execute(
                "UPDATE tasks SET state='leased', assigned_agent=?, lease_until=?, updated_at=? WHERE task_id=? AND state='queued'",
                (agent_id, lease_until, now, row["task_id"]),
            )
            db.execute("COMMIT")
            task_id = row["task_id"]
        self.emit("task.leased", agent_id, {"task_id": task_id, "lease_until": lease_until})
        return self.get_task(task_id)

    def transition(self, task_id: str, new_state: str, actor: str, *, result: dict[str, Any] | None = None) -> Task:
        if new_state not in TASK_STATES:
            raise ValueError(f"invalid state: {new_state}")
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
            if row is None:
                db.execute("ROLLBACK")
                raise KeyError(task_id)
            current = row["state"]
            if new_state not in ALLOWED_TRANSITIONS[current]:
                db.execute("ROLLBACK")
                raise ValueError(f"invalid transition {current} -> {new_state}")
            now = self.now()
            db.execute(
                "UPDATE tasks SET state=?, result_json=COALESCE(?,result_json), updated_at=? WHERE task_id=?",
                (new_state, json.dumps(result) if result is not None else None, now, task_id),
            )
            db.execute("COMMIT")
        self.emit("task.state_changed", actor, {"task_id": task_id, "from": current, "to": new_state})
        return self.get_task(task_id)

    def add_evidence(self, task_id: str, actor: str, evidence: dict[str, Any]) -> Task:
        with self._connect() as db:
            row = db.execute("SELECT evidence_json FROM tasks WHERE task_id=?", (task_id,)).fetchone()
            if row is None:
                raise KeyError(task_id)
            items = json.loads(row["evidence_json"] or "[]")
            items.append(evidence)
            db.execute(
                "UPDATE tasks SET evidence_json=?, updated_at=? WHERE task_id=?",
                (json.dumps(items), self.now(), task_id),
            )
        self.emit("task.evidence_added", actor, {"task_id": task_id, "evidence": evidence})
        return self.get_task(task_id)

    def verify(self, task_id: str, actor: str, status: str, note: str = "") -> Task:
        allowed = {"unverified", "pending", "verified", "rejected"}
        if status not in allowed:
            raise ValueError(f"invalid verification state: {status}")
        with self._connect() as db:
            row = db.execute("SELECT state FROM tasks WHERE task_id=?", (task_id,)).fetchone()
            if row is None:
                raise KeyError(task_id)
            if status == "verified" and row["state"] == "verifying":
                new_state = "completed"
            else:
                new_state = row["state"]
            db.execute(
                "UPDATE tasks SET verification=?, state=?, updated_at=? WHERE task_id=?",
                (status, new_state, self.now(), task_id),
            )
        self.emit("task.verified", actor, {"task_id": task_id, "verification": status, "note": note})
        if new_state != row["state"]:
            self.emit("task.state_changed", actor, {"task_id": task_id, "from": row["state"], "to": new_state})
        return self.get_task(task_id)

    def get_task(self, task_id: str) -> Task:
        with self._connect() as db:
            row = db.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        if row is None:
            raise KeyError(task_id)
        return self._row_to_task(row)

    def list_tasks(self, state: str | None = None, limit: int = 100) -> list[Task]:
        if limit <= 0:
            raise ValueError("limit must be positive")
        with self._connect() as db:
            if state is None:
                rows = db.execute("SELECT * FROM tasks ORDER BY priority DESC, created_at ASC LIMIT ?", (limit,)).fetchall()
            else:
                rows = db.execute(
                    "SELECT * FROM tasks WHERE state=? ORDER BY priority DESC, created_at ASC LIMIT ?",
                    (state, limit),
                ).fetchall()
        return [self._row_to_task(row) for row in rows]

    def status(self) -> dict[str, Any]:
        now = self.now()
        with self._connect() as db:
            agents = db.execute("SELECT COUNT(*) AS n FROM agents WHERE ? - last_heartbeat < 120", (now,)).fetchone()["n"]
            total_agents = db.execute("SELECT COUNT(*) AS n FROM agents").fetchone()["n"]
            rows = db.execute("SELECT state, COUNT(*) AS n FROM tasks GROUP BY state").fetchall()
        return {
            "schema_version": SCHEMA_VERSION,
            "live_agents": agents,
            "registered_agents": total_agents,
            "tasks": {row["state"]: row["n"] for row in rows},
        }

    @staticmethod
    def _row_to_task(row: sqlite3.Row) -> Task:
        return Task(
            task_id=row["task_id"],
            title=row["title"],
            objective=row["objective"],
            origin=row["origin"],
            priority=row["priority"],
            state=row["state"],
            assigned_agent=row["assigned_agent"],
            required_skills=tuple(json.loads(row["required_skills_json"] or "[]")),
            evidence=tuple(json.loads(row["evidence_json"] or "[]")),
            result=json.loads(row["result_json"]) if row["result_json"] else None,
            verification=row["verification"],
        )


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="EVEZ Swarm control-plane utility")
    parser.add_argument("--db", default=str(DEFAULT_DB))
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("status")
    p_agent = sub.add_parser("register")
    p_agent.add_argument("agent")
    p_agent.add_argument("role")

    p_hb = sub.add_parser("heartbeat")
    p_hb.add_argument("agent")

    p_task = sub.add_parser("enqueue")
    p_task.add_argument("title")
    p_task.add_argument("objective")
    p_task.add_argument("--priority", type=int, default=5)
    p_task.add_argument("--origin", default="user")

    p_claim = sub.add_parser("claim")
    p_claim.add_argument("agent")

    args = parser.parse_args()
    cp = ControlPlane(args.db)
    if args.command == "status":
        print(json.dumps(cp.status(), indent=2))
    elif args.command == "register":
        cp.register_agent(args.agent, args.role)
    elif args.command == "heartbeat":
        cp.heartbeat(args.agent)
    elif args.command == "enqueue":
        print(json.dumps(asdict(cp.create_task(args.title, args.objective, priority=args.priority, origin=args.origin)), indent=2))
    elif args.command == "claim":
        task = cp.claim_next(args.agent)
        print(json.dumps(asdict(task) if task else None, indent=2))
