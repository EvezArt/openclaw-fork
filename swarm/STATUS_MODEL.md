# EVEZ Declared vs Effective Status

The runtime must distinguish what a system claims to have done from what was externally observed.

| Field | Meaning |
| --- | --- |
| \`DECLARED\` | What an agent, prompt, config, or README says exists or occurred. |
| \`OBSERVED\` | What a local or external measurement directly recorded. |
| \`EFFECTIVE\` | What the capability actually demonstrated under a defined test. |
| \`LIVE\` | What was verified against a current external endpoint or service. |
| \`UNKNOWN\` | The evidence is insufficient to classify the state. |

Example:

\`\`\`json
{
  "component": "agent-runtime",
  "declared": "connected",
  "observed": "local_process_started",
  "effective": "local_simulation",
  "live": "unknown"
}
\`\`\`

A README badge, model-generated statement, or local simulation must never silently upgrade \`UNKNOWN\` to \`LIVE\`.

## CI taxonomy

- \`TEST_PASS\`
- \`TEST_FAIL\`
- \`RUNNER_FAILURE\`
- \`DEPENDENCY_FAILURE\`
- \`NETWORK_FAILURE\`
- \`NOT_EXECUTED\`
- \`UNKNOWN\`

A runner that dies before executing a test produces \`NOT_EXECUTED\` with an infrastructure reason.

## External effect taxonomy

- \`NONE\`
- \`REQUESTED\`
- \`CONFIRMED\`
- \`FAILED\`
- \`UNKNOWN\`

Agent narration is not confirmation.

The control plane should emit these states into the event stream so later systems can audit the distinction.
