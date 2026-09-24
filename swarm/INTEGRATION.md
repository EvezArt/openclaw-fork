# EVEZ repository-wide integration contract

The swarm treats the EvezArt repository fleet as a graph of typed capabilities rather than as one executable blob.

## Flow

source → ControlPlane task → worker → evidence → CAIN → WITNESS → event/memory → next task

## Evidence boundary

Claims are governed by swarm/CLAIM_CONTRACT.md.

The system keeps these layers distinct:

CLAIM != OBSERVATION != EVIDENCE != INFERENCE != LEGAL_CONCLUSION

The absence of a response is NO_RESPONSE, not proof of suppression.

The absence of prosecution is NO_PROSECUTION_OBSERVED, not proof of impunity.

Local simulation results remain simulation results.

## Status boundary

swarm/STATUS_MODEL.md defines DECLARED, OBSERVED, EFFECTIVE, LIVE, and UNKNOWN states.

Agent narration is not confirmation of an external effect.

CI infrastructure failure is not a test failure.

## Adapters

- event_source: produces observations/events; read-first.
- evidence_source: produces research or telemetry evidence.
- task_worker: consumes explicitly leased tasks.
- verification_gate: can reject or verify evidence/tasks.
- skill_registry: describes available capabilities.
- gateway: routes requests but does not gain autonomous authority.
- privileged_worker: requires verification before privileged action.
- orchestrator: proposes work; ControlPlane remains authoritative.
- observer: read-only operational surface.
- runtime: hosts autonomous execution loops behind leases.

## Demonstration

Run python swarm/demo.py in an environment with Python 3.11+. The demo is intentionally non-privileged: it creates a local SQLite task, registers the canonical agents, samples typed repository sources from ecosystem_manifest.json, attaches evidence, performs a contradiction-check record, passes the verification gate, and prints the resulting completion record.

It does not execute shell commands, deploy infrastructure, merge pull requests, access secrets, or mutate the source repositories.

## Migration rule

Existing runtimes should first become adapters to ControlPlane. They should not create a second authoritative queue. AgentNet/OODA remains the worker intelligence; the control plane owns durable task state and leases; EVEZ EventSpine and ledger systems become historical sources; verified outcomes become eligible memory inputs.

## Canonical durable spine

The dedicated EVEZ EventSpine repository is the durable JSONL implementation and verification reference:

https://github.com/EvezArt/evez-event-spine

The swarm may consume EventSpine events, but it must not claim that an event payload is true merely because it was recorded.
