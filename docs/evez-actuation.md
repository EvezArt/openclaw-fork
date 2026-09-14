# EVEZ Actuation

`evez-actuate` is the governed bridge between understanding and action. It integrates directly with OpenClaw’s plugin runtime inventory and dispatches approved low-impact work into the EVEZ context broker, media spine, workbench, and journey ledger.

## Operations

| Operation | Purpose | Side effect |
|---|---|---|
| `inspect` | Discover asset capabilities and available OpenClaw runtime namespaces | None |
| `recommend` | Select the smallest useful next operation | None |
| `preview` | Create an operation record with exact input, impact, approval boundary, and rollback note | Local operation record only |
| `execute` | Dispatch an approved low-impact EVEZ-local operation | Writes only to `.evez/` state |
| `verify` | Confirm output was recorded and mark the operation verified | Updates operation record |
| `rollback` | Mark an operation rolled back and preserve the corrective trail | Updates operation record |

## Core connector integration

OpenClaw plugins run in-process and expose selected `api.runtime` helpers. The actuator inventories those namespaces so it can adapt to the actual runtime rather than pretending every connector exists. Connector-specific external writes remain behind OpenClaw’s native tools and authorization controls. This prevents a convenience layer from bypassing channel allowlists, approvals, secret handling, or provider-specific policies.

The current low-impact dispatchers are:

- `context-index` → `evez-context-broker` ingestion.
- `media-register` → `evez-media-spine` registration.
- `workbench-add` → `evez-workbench` task creation.
- `journey-record` → `evez-journey` progress logging.

## Example flow

```text
inspect(document-17)
  → available: context-index, workbench-add
recommend(document-17)
  → context-index
preview(document-17, context-index)
  → operation op-...
execute(op-..., user-approved)
  → local context index updated
verify(op-...)
  → verified with output record
```

The actuator does not autonomously send email, publish, delete, alter billing, change credentials, approve devices, modify security controls, or execute arbitrary shell commands. Those actions require their native OpenClaw integration and the applicable approval policy.

## Product strategy

This is the fast path to making every asset convenient without making the system reckless. The user gives EVEZ an asset and desired outcome; EVEZ identifies capabilities, chooses the smallest reversible action, previews it, performs only the approved low-impact part, and leaves a durable evidence trail. Additional adapters can be added one connector at a time with tests for permissions, idempotency, rollback, and auditability.
