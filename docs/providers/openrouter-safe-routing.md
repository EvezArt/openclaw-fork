# OpenRouter safe routing

OpenClaw discovers the current OpenRouter catalog from `https://openrouter.ai/api/v1/models` when an OpenRouter credential is configured. Model IDs are not hard-coded, and catalog metadata is normalized into context length, vision input, reasoning hints, pricing, and bounded output tokens.

## Fail-closed spend policy

The OpenRouter guard runs **before** the model callback. A denied request does not reach OpenRouter and cannot spend credits.

Defaults:

- Free models (`:free` or catalog pricing of zero) are allowed.
- Paid models are blocked unless `OPENROUTER_ALLOW_PAID=1`.
- Maximum output is `2048` tokens unless changed with `OPENROUTER_MAX_OUTPUT_TOKENS`.
- Paid request estimate cap is `$0.05` via `OPENROUTER_MAX_REQUEST_USD`.
- Paid daily estimate cap is `$1.00` via `OPENROUTER_DAILY_BUDGET_USD`.
- Usage is stored under `$OPENCLAW_STATE_DIR/openrouter-budget.json` with mode `0600`.

Example explicit paid opt-in:

```bash
export OPENROUTER_ALLOW_PAID=1
export OPENROUTER_MAX_OUTPUT_TOKENS=1024
export OPENROUTER_MAX_REQUEST_USD=0.02
export OPENROUTER_DAILY_BUDGET_USD=0.50
```

If a paid model is blocked, normal model fallback continues. This makes local providers the preferred no-credit safety net.

## Tokenless/local fallback

Use an installed local runtime as the next candidate. Ollama is supported through the existing OpenAI-compatible provider discovery:

```json5
{
  models: {
    providers: {
      ollama: {
        baseUrl: "http://127.0.0.1:11434/v1",
        api: "openai-completions",
        models: [
          {
            id: "llama3.2",
            name: "Local Llama",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 32768,
            maxTokens: 2048,
          },
        ],
      },
    },
  },
  agents: {
    defaults: {
      model: {
        primary: "openrouter/meta-llama/llama-3.3-70b-instruct:free",
        fallbacks: ["ollama/llama3.2"],
      },
    },
  },
}
```

This arrangement gives: OpenRouter free model → local Ollama → no paid fallback. Do not add paid models to the fallback list unless the explicit paid environment gate and budget are intentional.

## Important boundary

Catalog discovery improves model compatibility; it does not guarantee that every provider-specific feature (tools, vision, reasoning controls, structured output) is supported by every model. OpenClaw should use the normalized capability fields and fail over when the upstream model rejects a feature.
