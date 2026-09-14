import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createEvezActuateTool } from "./evez-actuate.js";

function api(workspace: string) {
  return {
    config: { agents: { defaults: { workspace } } },
    pluginConfig: {},
    runtime: { media: {}, channel: {} },
  } as never;
}

describe("EVEZ actuator", () => {
  it("inspects and recommends without executing", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "evez-actuate-inspect-"));
    try {
      const tool = createEvezActuateTool(api(workspace));
      const inspected = await tool.execute("test", { action: "inspect", asset: { assetId: "doc-1", kind: "document", sensitivity: "personal" } });
      const details = inspected.details as { availableCapabilities: string[]; runtime: { runtimeNamespaces: string[] } };
      expect(details.availableCapabilities).toContain("context-index");
      expect(details.runtime.runtimeNamespaces).toContain("media");
      const recommended = await tool.execute("test", { action: "recommend", asset: { assetId: "doc-1", kind: "document" } });
      expect((recommended.details as { recommendation: { operation: string } }).recommendation.operation).toBe("context-index");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("requires explicit approval and executes only a low-impact local operation", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "evez-actuate-execute-"));
    try {
      const tool = createEvezActuateTool(api(workspace));
      const preview = await tool.execute("test", {
        action: "preview",
        asset: { assetId: "task-asset", kind: "task" },
        operation: "workbench-add",
        input: { task: { title: "Run the next safe step", impact: 4, urgency: 4 } },
      });
      const operationId = (preview.details as { operation: { operationId: string } }).operation.operationId;
      await expect(tool.execute("test", { action: "execute", operationId })).rejects.toThrow("user-approved");
      const executed = await tool.execute("test", { action: "execute", operationId, approval: "user-approved" });
      expect((executed.details as { operation: { status: string } }).operation.status).toBe("executed");
      const verified = await tool.execute("test", { action: "verify", operationId });
      expect((verified.details as { verified: boolean }).verified).toBe(true);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("refuses unapproved high-impact operations", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "evez-actuate-boundary-"));
    try {
      const tool = createEvezActuateTool(api(workspace));
      await expect(tool.execute("test", { action: "preview", asset: { assetId: "server-1", kind: "server" }, operation: "publish" })).rejects.toThrow("operation not available");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
