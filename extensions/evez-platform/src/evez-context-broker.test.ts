import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createEvezContextBrokerTool } from "./evez-context-broker.js";

function api(workspace: string) {
  return { config: { agents: { defaults: { workspace } } }, pluginConfig: {} } as never;
}

describe("EVEZ virtual context broker", () => {
  it("indexes, retrieves, and assembles cited context under a token budget", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "evez-context-test-"));
    try {
      const tool = createEvezContextBrokerTool(api(workspace));
      const ingested = await tool.execute("test", {
        action: "ingest",
        chunkTokens: 128,
        sources: [
          {
            id: "doc-a",
            title: "Operations report",
            text: "Gateway latency improved after queue backpressure was enabled.\n\nThe evidence includes a replayable benchmark and a rollback plan.",
          },
          {
            id: "doc-b",
            title: "Unrelated note",
            text: "The garden is healthy and the weather is clear.",
          },
        ],
      });
      expect((ingested.details as { chunksAdded: number }).chunksAdded).toBeGreaterThan(1);
      const assembled = await tool.execute("test", {
        action: "assemble",
        query: "queue backpressure benchmark",
        maxTokens: 256,
      });
      const details = assembled.details as { context: string; citations: Array<{ documentId: string }> };
      expect(details.context).toContain("backpressure");
      expect(details.citations.some((citation) => citation.documentId === "doc-a")).toBe(true);
      expect(details.context).toContain("[doc-a#");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("reports the virtual context capacity separately from the model's native window", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "evez-context-stats-"));
    try {
      const result = await createEvezContextBrokerTool(api(workspace)).execute("test", { action: "stats" });
      expect((result.details as { virtualContextTokens: number }).virtualContextTokens).toBeGreaterThanOrEqual(2_000_000);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
