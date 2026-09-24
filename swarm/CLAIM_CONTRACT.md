# EVEZ Claim-to-Reality Contract

The swarm must keep these layers distinct:

\`CLAIM != OBSERVATION != EVIDENCE != INFERENCE != LEGAL_CONCLUSION\`

## Pipeline

\`\`\`
CLAIM
  -> TERMS
  -> OBSERVABLES
  -> SOURCES
  -> TRANSFORMS
  -> TESTS
  -> RESULT
  -> CONTRADICTION
  -> UPDATE
\`\`\`

## State model

- \`PROPOSED\`: a claim exists but has not passed an evidence test.
- \`SUPPORTED\`: available evidence materially supports the claim but does not establish it conclusively.
- \`VERIFIED\`: the stated test completed successfully against identified evidence.
- \`INFERRED\`: the result depends on an explicit inference rather than a directly observed fact.
- \`UNKNOWN\`: required evidence or a valid test is missing.
- \`STALE\`: the evidence is no longer current for the stated question.
- \`CONTRADICTED\`: credible evidence conflicts with the claim or its required premises.
- \`RETRACTED\`: the claim has been withdrawn.

## Forbidden promotion

\`\`\`
UNKNOWN -> VERIFIED
UNKNOWN -> SUPPORTED
PROPOSED -> VERIFIED
\`\`\`

Those transitions are prohibited merely because more prose was generated.

The absence of a response is recorded as \`NO_RESPONSE\`, not as proof of suppression, misconduct, or causation.

The absence of prosecution is recorded as \`NO_PROSECUTION_OBSERVED\`, not as proof of impunity.

A local simulation score is recorded as a simulation result, not as evidence of a live external state.

## Evidence object

Every evidence attachment should identify:

- source URI or immutable local reference
- retrieval timestamp
- content hash when available
- extraction method
- proposition supported or contradicted
- scope and limitations
- actor that attached it

## Verification authority

CAIN may reject or mark a contradiction.

WITNESS may verify that a defined test ran against the cited evidence.

Neither agent may turn an unobserved external condition into a verified fact.

SPINE records the result. It does not decide whether the result is true.

## Design invariant

**No state advance without a reason that can be replayed by another observer.**
