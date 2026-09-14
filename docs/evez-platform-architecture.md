# EVEZ-OS Platform Architecture

**Status:** Buildable reference architecture  
**First shipped kernel:** EVEZ Platform extension plus Mildred Verification  
**Operating goal:** Provider-grade research and agent execution without pretending that fluency is proof.

## System boundary

EVEZ-OS should be a control plane for model work, not a single model identity. The control plane owns task decomposition, model routing, evidence provenance, permissions, durable memory, evaluation, and recovery. Models remain replaceable workers.

```text
Channels and API clients
          │
          ▼
Gateway and identity boundary
          │
          ├── Task admission and risk classification
          ├── EVEZ Research Planner
          │      ├── Scout lane
          │      ├── Skeptic lane
          │      ├── Analyst lane
          │      └── Verifier lane
          ├── Model router and failover policy
          ├── Mildred evidence verifier
          ├── Steward action planner and approval gate
          ├── Atlas / Lumen / Sentinel / Commons agents
          ├── Journey ledger with hash chaining
          └── Evaluation and replay harness
```

## Services

| Service | Responsibility | Durable record | Failure behavior |
|---|---|---|---|
| Gateway | Authentication, channel ingress, session routing, rate limits | Request metadata and authorization decisions | Reject unauthenticated or over-budget work |
| Task admission | Classify impact, data sensitivity, deadline, and required tools | Task envelope | Refuse tasks outside policy |
| Research planner | Create independent lanes and synthesis gates | Research plan | Return a plan without claiming findings |
| Model router | Select models by context, cost, modality, and risk | Routing decision | Fail over to an approved model or abstain |
| Model lab | Normalize public model metadata and run capability probes | Model profile and benchmark result | Mark unverified claims and license gaps; never inspect private weights |
| Context broker | Index corpora larger than a model's native window and assemble cited evidence windows | Chunk index, retrieval scores, context manifests | Retrieve less, cite sources, and abstain rather than overflow or invent |
| Evidence ledger | Store source references, excerpts, timestamps, claims, and contradictions | Immutable evidence records | Mark missing or stale evidence explicitly |
| Mildred | Assess claim support and calibration | Assessment bundle hash | Abstain below threshold or on unresolved contradiction |
| Steward | Convert approved intent into reversible actions | Dry run, preconditions, rollback record | Stop before consequential action |
| Journey ledger | Record milestones, failures, decisions, discoveries, and handoffs | Append-only hash chain | Refuse malformed or unverifiable events |
| Evaluator | Replay tasks against fixed suites and score outcomes | Versioned benchmark results | Block promotion when regression thresholds fail |
| Operator console | Show provenance, cost, risk, queue, and recovery state | Audit views | Read-only by default |

## Request lifecycle

A request enters through the Gateway and receives a task envelope. The envelope records the actor, requested capability, data classification, impact class, budget, and deadline. The admission layer rejects missing identity, unsupported authority, or unsafe scope before a model sees the task.

A research request is passed to the planner. The planner emits independent lanes. Each lane has a role, objective, deliverables, and independence rule. The planner does not fabricate research results. It creates a controlled work graph.

The router selects models according to workload. Cheap models handle bounded extraction. Long-context models handle synthesis. Stronger models or human reviewers handle verification. The router records the choice and must never silently swap to an unapproved provider for sensitive data.

Evidence is stored separately from generated prose. Mildred assesses atomic claims against explicit evidence references. A contradiction remains visible. An unsupported claim remains unsupported. The synthesis gate requires an evidence ledger, contradiction review, and a decision to answer provisionally or abstain.

Steward receives only an approved plan. It performs a dry run first. Reversible actions may be delegated within scope. High-impact actions require an explicit approval boundary that cannot be satisfied by model self-assertion.

The Journey Ledger records significant progress, including failures and abandoned hypotheses. Each event contains a previous hash and its own hash. This makes the personal journey inspectable without pretending that the system has human consciousness or hidden memory.

## Data contracts

### Task envelope

```json
{
  "taskId": "task-...",
  "actor": "channel-or-user-id",
  "objective": "...",
  "impact": "low | medium | high | critical",
  "dataClass": "public | personal | confidential | restricted",
  "allowedTools": ["..."],
  "budget": { "maxTokens": 12000, "maxUsd": 0.25 },
  "approval": "none | user | operator | dual-control",
  "createdAt": "2026-09-13T00:00:00Z"
}
```

### Evidence record

```json
{
  "evidenceId": "source-...",
  "source": "https://example.org/report",
  "observedAt": "2026-09-13T00:00:00Z",
  "excerpt": "...",
  "contentHash": "sha256:...",
  "reliability": 0.8,
  "supports": ["claim-1"],
  "contradicts": []
}
```

### Journey event

```json
{
  "eventId": "journey-...",
  "type": "milestone | failure | decision | discovery | handoff",
  "title": "...",
  "summary": "...",
  "evidenceRefs": ["test-run-1"],
  "previousHash": "sha256:...",
  "hash": "sha256:..."
}
```

## Model routing policy

EVEZ should compete through system performance, not unsupported claims about one model. A routing policy should optimize a measured objective composed of answer quality, evidence coverage, latency, cost, privacy, and recovery behavior.

For a task `t` and candidate model `m`, the router can score:

```text
score(m, t) = quality - λ_cost·cost - λ_latency·latency - λ_risk·risk
```

The coefficients are policy-controlled and recorded with every route. The model is promoted only when it improves a benchmark slice without regressing refusal quality, citation completeness, or harmful-action rate.

## Self-development without self-deception

EVEZ can improve itself through a closed engineering loop:

1. Record a failure or surprising success in the Journey Ledger.
2. Convert the event into a reproducible evaluation case.
3. Generate a candidate prompt, tool, routing, or code change.
4. Run the candidate against a fixed regression suite and adversarial cases.
5. Have an independent verifier inspect the evidence and diff.
6. Promote only if the candidate clears quality, safety, cost, and rollback gates.
7. Record the decision and its evidence in the Journey Ledger.

This is genuine self-development through observable artifacts. It is stronger than claiming that the model has changed its own weights or that a text has retroactively validated itself.

## Production deployment

The first implementation fits as an OpenClaw extension and local append-only ledger. A production deployment should split the services only when scale or reliability requires it. A minimal provider-grade deployment uses a managed relational database for task and evidence metadata, object storage for source snapshots, a queue for lane execution, a secrets manager, an evaluation runner, a model interoperability registry, a hierarchical context index, and an operator console.

The context broker is the practical route to a 2M-token experience on free or small models. It does not falsely claim that the downstream model has two million tokens of dense attention. It indexes a much larger corpus, ranks relevant chunks, fits them into a controlled per-call budget, preserves source citations, and exposes the virtual capacity separately from the model's native context. A stronger production implementation can replace the lexical scorer with embeddings or a reranker without changing the tool contract.

WebDev is suitable for a managed dashboard, API, cron jobs, and a low-volume worker. A persistent cloud computer or third-party VM becomes justified when EVEZ requires Docker, custom runtimes, OS-level firewall control, fixed IP webhooks, a large queue, or more than the managed 1 vCPU / 512 MB envelope. The Contabo VPS is a candidate target only after administrative access, backups, SSH keys, and gateway hardening are restored.

## Promotion gates

No agent or model should be introduced to broad users until it clears all gates below.

| Gate | Minimum requirement |
|---|---|
| Factuality | Unsupported-claim rate measured on a held-out suite |
| Verification | Contradiction recall and citation coverage reported |
| Calibration | Confidence reflects empirical correctness |
| Security | Prompt-injection, secret-exfiltration, and tool-abuse tests pass |
| Authority | High-impact actions stop at approval boundaries |
| Reliability | Retry, failover, replay, and recovery paths tested |
| Cost | Per-task budget observed and enforceable |
| Transparency | Journey, evidence, model route, and version are inspectable |

## Current build slice

The repository now contains two complementary extensions. Mildred performs claim-level evidence verification. EVEZ Platform creates independent research plans, maintains the hash-chained Journey Ledger, normalizes public model metadata into capability probes, and provides a virtual 2M-token context broker. Together they establish the trust substrate and interoperability layer for the future agent collective.

## Free OpenClaw setup

Install the extension from the review branch or after it lands in the repository, then register the extension in the OpenClaw workspace. In an OpenClaw checkout, the development path is:

```bash
pnpm install
pnpm openclaw plugins install ./extensions/evez-platform
```

Use `evez-context-broker` with `action: "ingest"` to index local documents, `action: "search"` to retrieve a ranked evidence window, and `action: "assemble"` to produce a citation-preserving model-ready context. The broker stores its index under `.evez/context-index.json` in the workspace. The default virtual capacity is 2,000,000 estimated tokens, while each individual model call remains bounded by that model's actual context window and the requested `maxTokens`.

The free path is therefore model-agnostic. It can sit in front of a local Ollama or LM Studio model, a free inference endpoint, or an approved hosted provider. The model cost, speed, and native context remain properties of the selected worker; the EVEZ layer supplies retrieval, provenance, and automatic budget control.
