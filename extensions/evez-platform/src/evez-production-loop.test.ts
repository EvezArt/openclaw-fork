import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createEvezProductionLoopTool } from "./evez-production-loop.js";

function api(workspace: string) {
  return { config: { agents: { defaults: { workspace } } }, pluginConfig: {} } as never;
}

describe("EVEZ production loop", () => {
  it("processes bounded paper jobs and writes an evidence-seeking draft", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "evez-production-paper-"));
    try {
      const tool = createEvezProductionLoopTool(api(workspace));
      const queued = await tool.execute("test", { action: "enqueue", kind: "paper", title: "Resilient Agent Operations", input: { thesis: "Bounded queues improve recovery.", sources: ["https://example.org/source"] } });
      const jobId = (queued.details as { job: { jobId: string } }).job.jobId;
      const tick = await tool.execute("test", { action: "tick", maxJobs: 1 });
      const processed = (tick.details as { processed: Array<{ jobId: string; status: string; output: string }> }).processed[0];
      expect(processed?.jobId).toBe(jobId);
      expect(processed?.status).toBe("completed");
      const paper = await readFile(processed?.output ?? "", "utf8");
      expect(paper).toContain("Evidence-seeking draft");
      expect(paper).toContain("[1]");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("recovers running jobs and signs a checkpoint", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "evez-production-recovery-"));
    try {
      const tool = createEvezProductionLoopTool(api(workspace));
      await tool.execute("test", { action: "enqueue", kind: "research", title: "Recovery study", maxAttempts: 2 });
      const first = await tool.execute("test", { action: "tick", maxJobs: 0 as never });
      expect((first.details as { processed: unknown[] }).processed).toHaveLength(0);
      const checkpoint = await tool.execute("test", { action: "checkpoint" });
      const details = checkpoint.details as { checkpoint: { hash: string; signature: string; publicKey: string } };
      expect(details.checkpoint.hash).toHaveLength(64);
      expect(details.checkpoint.signature.length).toBeGreaterThan(20);
      expect(details.checkpoint.publicKey).toContain("PUBLIC KEY");
      const status = await tool.execute("test", { action: "status" });
      expect((status.details as { jobs: unknown[] }).jobs).toHaveLength(1);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
