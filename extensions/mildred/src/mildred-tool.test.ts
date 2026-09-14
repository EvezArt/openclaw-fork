import { describe, expect, it } from "vitest";

import { createMildredTool } from "./mildred-tool.js";

const api = { config: {}, pluginConfig: {} } as never;

function run(input: Record<string, unknown>) {
  return createMildredTool(api).execute("test", input) as Promise<{
    details: {
      answerability: string;
      overallConfidence: number;
      assessments: Array<{ status: string }>;
      evidenceBundleSha256: string;
    };
  }>;
}

describe("Mildred verification", () => {
  it("supports a claim only when linked evidence outweighs contradiction", async () => {
    const result = await run({
      question: "Is the service healthy?",
      claims: [{ id: "health", text: "The service is healthy", importance: "high" }],
      evidence: [
        { id: "probe-1", source: "health check", text: "HTTP 200", supports: ["health"], reliability: 0.9 },
      ],
    });
    expect(result.details.answerability).toBe("answerable");
    expect(result.details.assessments[0]?.status).toBe("supported");
    expect(result.details.overallConfidence).toBe(1);
    expect(result.details.evidenceBundleSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("abstains on unsupported claims", async () => {
    const result = await run({
      question: "What happened?",
      claims: [{ id: "cause", text: "The outage was caused by a deployment" }],
      evidence: [],
    });
    expect(result.details.answerability).toBe("abstain");
    expect(result.details.assessments[0]?.status).toBe("unassessed");
  });

  it("preserves contradictions instead of averaging them away", async () => {
    const result = await run({
      question: "Is the service healthy?",
      claims: [{ id: "health", text: "The service is healthy" }],
      evidence: [
        { id: "a", source: "probe-a", text: "HTTP 200", supports: ["health"], reliability: 0.8 },
        { id: "b", source: "probe-b", text: "Timeout", contradicts: ["health"], reliability: 0.8 },
      ],
    });
    expect(result.details.answerability).toBe("abstain");
    expect(result.details.assessments[0]?.status).toBe("mixed");
  });
});
