import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createEvezMediaSpineTool } from "./evez-media-spine.js";

function api(workspace: string) {
  return { config: { agents: { defaults: { workspace } } }, pluginConfig: {} } as never;
}

describe("EVEZ media spine", () => {
  it("registers audio and video evidence with timestamped segments and lineage", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "evez-media-test-"));
    try {
      const tool = createEvezMediaSpineTool(api(workspace));
      const video = await tool.execute("test", {
        action: "register",
        asset: {
          assetId: "video-1",
          kind: "video",
          uri: "file:///evidence/interview.mp4",
          contentHash: "sha256-video-1",
          rights: "consented",
          sensitivity: "personal",
          segments: [
            { id: "seg-1", kind: "transcript", text: "The deployment succeeded after rollback testing.", startMs: 0, endMs: 4200, confidence: 0.94, sourceModel: "transcriber-v1" },
            { id: "seg-2", kind: "video-event", text: "terminal shows a green deployment status", startMs: 5000, endMs: 8000, confidence: 0.82, sourceModel: "vision-v1" },
          ],
        },
      });
      expect((video.details as { asset: { assetId: string } }).asset.assetId).toBe("video-1");
      const derived = await tool.execute("test", {
        action: "register",
        asset: {
          assetId: "transcript-1",
          kind: "document",
          uri: "file:///evidence/interview.txt",
          contentHash: "sha256-transcript-1",
          rights: "consented",
          sensitivity: "personal",
          derivativeOf: "video-1",
          segments: [{ id: "text-1", kind: "transcript", text: "rollback testing" }],
        },
      });
      expect((derived.details as { asset: { derivativeOf: string } }).asset.derivativeOf).toBe("video-1");
      const lineage = await tool.execute("test", { action: "lineage", assetId: "transcript-1" });
      expect((lineage.details as { chain: unknown[] }).chain).toHaveLength(2);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("blocks non-public media with unknown rights and redacts restricted content", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "evez-media-security-"));
    try {
      const tool = createEvezMediaSpineTool(api(workspace));
      await expect(tool.execute("test", {
        action: "register",
        asset: { kind: "audio", uri: "file:///private.wav", contentHash: "sha256-private", rights: "unknown", sensitivity: "personal", segments: [] },
      })).rejects.toThrow("rights must be established");
      const registered = await tool.execute("test", {
        action: "register",
        asset: { assetId: "restricted-1", kind: "audio", uri: "file:///restricted.wav", contentHash: "sha256-restricted", rights: "consented", sensitivity: "restricted", segments: [{ id: "r-1", kind: "transcript", text: "secret text" }] },
      });
      const asset = (registered.details as { asset: { uri: string; segments: Array<{ text: string }> } }).asset;
      expect(asset.uri).toContain("withheld");
      expect(asset.segments[0]?.text).toContain("withheld");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
