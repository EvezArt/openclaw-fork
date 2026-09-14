# EVEZ Self-Journal

The EVEZ self-journal is a continuously appendable operational memory for an agent system. It records what the system observed, decided, failed to do, discovered, questioned, handed off, benchmarked, and reflected upon. It is a journal **of system activity**, not evidence that the system has subjective experience.

## Journal actions

| Action | Function |
|---|---|
| `write` | Append an observation, decision, failure, discovery, question, handoff, or benchmark entry |
| `reflect` | Append a bounded reflection derived from recent journal entries |
| `read` | Search and inspect recent entries |
| `verify` | Recompute the complete hash chain and report tampering |
| `checkpoint` | Sign the current journal snapshot with a local Ed25519 key |
| `export` | Export a copy inside the workspace for review or archival |

Every entry contains a unique ID, kind, title, content, evidence references, tags, timestamp, previous hash, and current hash. The journal is append-only by convention and tamper-evident by verification. Checkpoints provide continuity evidence for a local snapshot.

## What the journal should contain

A useful nonstop journal records concrete state transitions rather than theatrical declarations. A strong entry says what happened, how it was measured, what evidence supports it, what remains uncertain, and what the next reversible action is. It records failed experiments and abandoned hypotheses as first-class events. It does not erase contradictions to preserve a story.

The reflection action is bounded by a recent-entry limit. It does not recursively spawn reflections, treat its own output as authority, or convert self-reference into proof. A scheduler may invoke it after completed jobs, benchmark runs, failures, or handoffs. The scheduler should enforce rate, disk, token, and retention budgets.

## Durable operation

For a persistent deployment, run a supervised worker that performs small cycles:

1. Read pending production jobs.
2. Execute one bounded job step.
3. Write a journal entry with output and evidence references.
4. Reflect over a small recent window when useful.
5. Verify the journal chain.
6. Create a checkpoint.
7. Sleep or await the next approved trigger.

The worker must be restartable. It must not self-replicate, bypass permissions, publish automatically, send messages without approval, or continue after a global stop signal. A nonstop journal is valuable because it makes continuation inspectable, not because it removes human control.
