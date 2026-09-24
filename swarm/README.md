# EVEZ Swarm Foundation

This directory is the coordination substrate for the EVEZ multi-agent ecosystem.

## The invariant

There is one authoritative state machine for work. Agents may reason independently, but task ownership and task state are transactional.

- `control_plane.py` stores agents, tasks, leases, events, evidence, and verification state.
- `agents.json` defines the canonical EVEZ agent roster and verification policy.
- `healthcheck.py` proves that the lifecycle works end-to-end without external services.

## Task lifecycle

`queued -> leased -> running -> verifying -> completed`

Failure/recovery states are explicit: `blocked`, `failed`, and `cancelled`. Expired leases are re-queued so a dead agent cannot permanently strand a task.

## Verification gate

Research and agent outputs should attach evidence while a task is active. A task reaches `completed` through the verification gate, not by assertion alone.

## Why SQLite first

The existing EVEZ stack includes mobile/small-environment targets and several JSON/JSONL memory stores. SQLite WAL gives a single transactional source of truth with no additional service dependency. A remote Postgres/event-bus deployment can later implement the same logical contract.

## Integration target

SPINE should consume queued tasks and publish state changes. AgentNet specialists register themselves and heartbeat. HARVEST/SCOUT attach evidence; CAIN can reject or block weak results; WITNESS can verify accepted results; DEPLOY remains a privileged executor.

This layer intentionally does not execute arbitrary shell commands or automatically merge/deploy code. Capability expansion belongs above the control plane and must pass the same state and verification boundaries.
