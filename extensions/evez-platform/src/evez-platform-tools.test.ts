import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createEvezJourneyTool, createEvezResearchTool } from "./evez-platform-tools.js";

function api(workspace: string) {
  return { config: { agents: { defaults: { workspace } } }, pluginConfig: {} } as never;
}

describe("EVEZ platform kernel", () => {
  it("creates independent research lanes and a synthesis gate", async () => {
    const tool = createEvezResearchTool(api(process.cwd()));
    const result = await tool.execute("test", {
      question: "What caused the outage?",
      context: "Three services degraded.",
      consequential: true,
    });
    const details = result.details as { status: string; lanes: unknown[]; synthesisGate: { abstainIfUnresolved: boolean; consequentialActionApproval: boolean } };
    expect(details.status).toBe("planned");
    expect(details.lanes).toHaveLength(4);
    expect(details.synthesisGate.abstainIfUnresolved).toBe(true);
    expect(details.synthesisGate.consequentialActionApproval).toBe(true);
  });

  it("records and verifies a hash-chained journey", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "evez-platform-test-"));
    try {
      const tool = createEvezJourneyTool({
        config: { agents: { defaults: { workspace } } },
        pluginConfig: {},
      } as never);
      await tool.execute("test", {
        action: "record",
        event: {
          type: "milestone",
          title: "Mildred passed verification",
          summary: "Three focused tests passed.",
          evidenceRefs: ["test-run-1"],
          actor: "mildred",
        },
      });
      const verified = await tool.execute("test", { action: "verify" });
      expect((verified.details as { valid: boolean }).valid).toBe(true);
      const listed = await tool.execute("test", { action: "list" });
      expect((listed.details as { count: number }).count).toBe(1);
      const lines = await readFile(path.join(workspace, ".evez", "journey.jsonl"), "utf8");
      expect(lines.trim().split("\n")).toHaveLength(1);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
