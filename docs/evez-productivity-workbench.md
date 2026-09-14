# EVEZ Productivity Workbench

The productivity workbench is the safe, useful core extracted from the attached brief. It does not treat a person as disposable, a ledger as sovereign, or a self-referential narrative as proof. It turns goals into small observable actions while keeping dependencies, energy, urgency, impact, and completion evidence explicit.

## Operating loop

The workbench follows a sense-plan-act-review loop. **Sense** records the task, objective, dependencies, energy, deadline, and available evidence. **Plan** ranks ready work using impact, urgency, dependency readiness, energy fit, due date, and estimated effort. **Act** starts one task at a time within the user's existing authority. **Review** records completion evidence, failure, or a deliberate drop decision in a hash-chained history.

This is deliberately simpler than an autonomous swarm. A good productivity system should reduce cognitive load, not create an invisible second job managing agents.

## Tool actions

| Action | Purpose |
|---|---|
| `add` | Create a task with objective, impact, urgency, energy, estimate, dependencies, tags, and next action |
| `list` | Show all ready and active work ranked by score |
| `next` | Recommend the single highest-value ready task |
| `start` | Mark a task as doing and record an event |
| `complete` | Mark a task done and attach completion evidence |
| `drop` | Deliberately stop work and record why or what was dropped |
| `stats` | Show status counts and history size |

The workbench stores local state at `.evez/workbench.json`. The event history is hash-chained so progress is replayable and tampering is detectable. It does not silently create external side effects, contact people, spend money, change accounts, or modify systems.

## Score model

The current score is intentionally interpretable:

```text
score = 4·impact + 3·urgency + dependency_readiness + energy_fit + due_date_pressure - effort_hours
```

This is a starting policy, not a claim of universal optimality. The Journey Ledger and evaluation suite should record when a recommendation was useful or wrong. Future versions can learn per-user preferences from explicit feedback, but they should not infer sensitive traits or manipulate the user through hidden pressure.

## Productive expansion path

The workbench can become a complete personal operating system by adding calendar-aware time blocks, inbox capture, project rollups, recurring tasks, document links, context-broker retrieval, media evidence, and reversible automations. Each integration should preserve the same boundary: propose first, show the material action, execute only within granted authority, and record the result.

The safe productivity breakthrough is not an agent that “needs no user.” It is a system that reliably turns a user's intention into the next clear action, remembers why it exists, surfaces the evidence of progress, and makes it easy to correct.
