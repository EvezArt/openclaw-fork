import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertOpenRouterRequestAllowed, OpenRouterBudgetError } from "./openrouter-guard.js";

const original = { ...process.env };
let tempDir: string | undefined;

afterEach(async () => {
  process.env = { ...original };
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
  tempDir = undefined;
});

describe("OpenRouter budget guard", () => {
  it("allows free models without paid opt-in", () => {
    expect(() =>
      assertOpenRouterRequestAllowed({ model: "meta-llama/llama-3.3-8b-instruct:free" }),
    ).not.toThrow();
  });

  it("blocks paid models unless explicitly opted in", () => {
    tempDir = path.join(os.tmpdir(), `openrouter-guard-${Date.now()}`);
    process.env.OPENCLAW_STATE_DIR = tempDir;
    const cfg = {
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
                cost: { input: 1, output: 100, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 8192,
                maxTokens: 1024,
              },
            ],
          },
        },
      },
    } as never;
    expect(() => assertOpenRouterRequestAllowed({ model: "acme/paid", cfg })).toThrow(
      OpenRouterBudgetError,
    );
  });
});
