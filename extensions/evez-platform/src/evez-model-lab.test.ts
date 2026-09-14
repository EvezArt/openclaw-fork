import { describe, expect, it } from "vitest";

import { createEvezModelLabTool } from "./evez-model-lab.js";

const api = { config: {}, pluginConfig: {} } as never;

const models = [
  {
    id: "hermes-3",
    provider: "NousResearch",
    baseModel: "Llama-3.1-8B",
    license: "llama3",
    capabilities: ["function calling", "json mode", "chat"],
    sourceUrl: "https://hf.co/NousResearch/Hermes-3-Llama-3.1-8B",
    evidenceRefs: ["hf-card"],
  },
  {
    id: "hermes-4.3",
    provider: "NousResearch",
    baseModel: "Seed-OSS-36B-Base",
    license: "apache-2.0",
    capabilities: ["reasoning", "tool use", "structured outputs", "long context"],
    quantization: "GGUF",
    sourceUrl: "https://hf.co/NousResearch/Hermes-4.3-36B-GGUF",
    evidenceRefs: ["hf-card"],
  },
];

describe("EVEZ model lab", () => {
  it("normalizes model metadata and warns about quantized artifacts", async () => {
    const result = await createEvezModelLabTool(api).execute("test", { action: "normalize", models });
    const details = result.details as { models: Array<{ license: string; warnings: string[] }> };
    expect(details.models[0]?.license).toBe("llama3");
    expect(details.models[1]?.warnings).toContain("quantized artifact: GGUF");
  });

  it("ranks models by declared capabilities and produces probes", async () => {
    const result = await createEvezModelLabTool(api).execute("test", {
      action: "probe-plan",
      models,
      workload: "reasoning with tools and long context",
    });
    const details = result.details as { ranked: Array<{ model: { id: string } }>; probeSuite: unknown[] };
    expect(details.ranked[0]?.model.id).toBe("hermes-4.3");
    expect(details.probeSuite.length).toBeGreaterThanOrEqual(5);
  });
});
