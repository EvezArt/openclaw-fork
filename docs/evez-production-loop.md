# EVEZ Production Loop

The EVEZ production loop is a bounded worker for continuing coding, research, and paper development across restarts. It is deliberately not an unbounded self-spawning agent. Each invocation processes a configured maximum number of jobs, persists the state, records attempts, and returns control to the supervising scheduler or operator.

## Job classes

| Class | Current behavior | Promotion path |
|---|---|---|
| `code` | Persists an implementation brief for a benchmarked coding pass | Connect to a reviewable branch worker and CI gate |
| `research` | Persists an evidence-seeking research brief | Connect to approved search/fetch workers and source ledger |
| `paper` | Writes an evidence-seeking Markdown paper scaffold with references and limitations | Run source collection, Mildred verification, peer review, and publication approval |

The paper writer is intentionally honest. It can create a useful structure immediately, but it does not convert a hypothesis, a prompt, or a generated paragraph into a finding. It labels drafts, preserves supplied sources, asks for disconfirming evidence, and states what has not been independently reviewed.

## Controls

The loop provides checkpointing, Ed25519 signatures, bounded ticks, attempt limits, recovery of interrupted running jobs, and durable status. The private signing key is generated locally with restrictive file permissions and stays in the workspace’s `.evez` directory. A checkpoint signature proves continuity of the local state; it does not prove truth, authorship, legal authority, military certification, or peer review.

A supervised runner may invoke `tick` periodically. The runner should impose a wall-clock budget, concurrency limit, workspace quota, and explicit network policy. External publication, messaging, purchases, account changes, credential changes, deletion, and security changes must remain separate approval-gated operations.

## Recommended continuous mode

1. Enqueue a small coding, research, or paper job.
2. Run one bounded `tick`.
3. Inspect outputs and test results.
4. Record a Journey Ledger event.
5. Run `checkpoint`.
6. Resume pending jobs after restart.
7. Promote only artifacts that clear evaluation, rights, security, and review gates.

This produces a nonstop *continuation capability* without creating an unstoppable process that can fork itself, consume unbounded resources, publish unsupported claims, or act beyond the user’s authority.
