import { afterEach, describe, expect, it, vi } from "vitest";
import { runWithModelFallback } from "./model-fallback.js";

const previousPaid = process.env.OPENROUTER_ALLOW_PAID;

afterEach(() => {
  if (previousPaid === undefined) {
    delete process.env.OPENROUTER_ALLOW_PAID;
  } else {
    process.env.OPENROUTER_ALLOW_PAID = previousPaid;
  }
});

describe("OpenRouter safe fallback", () => {
  it("does not call a paid model when paid access is not explicitly enabled", async () => {
    delete process.env.OPENROUTER_ALLOW_PAID;
    const run = vi.fn(async (provider: string) => {
      if (provider === "openrouter") {
        throw new Error("paid model was called");
      }
      return "local response";
    });
    const cfg = {
      agents: {
        defaults: { model: { primary: "openrouter/acme/paid", fallbacks: ["ollama/local-model"] } },
      },
      models: {
        providers: {
          openrouter: {
            baseUrl: "https://openrouter.ai/api/v1",
            models: [
              {
                id: "acme/paid",
                name: "Paid",
                reasoning: false,
                input: ["text"],
                cost: { input: 1, output: 10, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 8192,
                maxTokens: 1024,
              },
            ],
          },
        },
      },
    } as never;
    const result = await runWithModelFallback({
      cfg,
      provider: "openrouter",
      model: "acme/paid",
      run,
    });
    expect(result.result).toBe("local response");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("ollama", "local-model");
    expect(result.attempts[0]?.reason).toBe("billing");
  });
});
