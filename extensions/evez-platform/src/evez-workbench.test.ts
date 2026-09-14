import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createEvezWorkbenchTool } from "./evez-workbench.js";

function api(workspace: string) {
  return { config: { agents: { defaults: { workspace } } }, pluginConfig: {} } as never;
}

describe("EVEZ productivity workbench", () => {
  it("prioritizes ready work and records completion evidence", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "evez-workbench-test-"));
    try {
      const tool = createEvezWorkbenchTool(api(workspace));
      const first = await tool.execute("test", { action: "add", task: { title: "Ship benchmark", impact: 5, urgency: 5, energy: "medium", nextAction: "Run the benchmark" } });
      const firstTaskId = (first.details as { task: { id: string } }).task.id;
      await tool.execute("test", { action: "add", task: { title: "Write release note", impact: 3, urgency: 2, dependencies: [firstTaskId] } });
      const next = await tool.execute("test", { action: "next", energyAvailable: "medium" });
      expect((next.details as { recommendation: { taskId: string } }).recommendation.taskId).toBe(firstTaskId);
      await tool.execute("test", { action: "start", taskId: firstTaskId });
      const completed = await tool.execute("test", { action: "complete", taskId: firstTaskId, completionEvidence: ["benchmark-run-2026-09-13"] });
      expect((completed.details as { task: { status: string; completionEvidence: string[] } }).task.status).toBe("done");
      expect((completed.details as { task: { completionEvidence: string[] } }).task.completionEvidence).toContain("benchmark-run-2026-09-13");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("keeps dependent work unavailable until the dependency is complete", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "evez-workbench-dependency-"));
    try {
      const tool = createEvezWorkbenchTool(api(workspace));
      const dependency = await tool.execute("test", { action: "add", task: { title: "Collect evidence" } });
      const dependencyId = (dependency.details as { task: { id: string } }).task.id;
      await tool.execute("test", { action: "add", task: { title: "Synthesize findings", dependencies: [dependencyId], impact: 5, urgency: 5 } });
      const next = await tool.execute("test", { action: "next" });
      expect((next.details as { tasks: Array<{ task: { title: string } }> }).tasks.every((item) => item.task.title !== "Synthesize findings")).toBe(true);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
