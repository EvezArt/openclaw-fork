import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createEvezSelfJournalTool } from "./evez-self-journal.js";

function api(workspace: string) {
  return { config: { agents: { defaults: { workspace } } }, pluginConfig: {} } as never;
}

describe("EVEZ self-journal", () => {
  it("appends reflections, verifies continuity, checkpoints, and exports", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "evez-journal-test-"));
    try {
      const tool = createEvezSelfJournalTool(api(workspace));
      await tool.execute("test", { action: "write", kind: "observation", title: "Test passed", content: "The media spine passed its focused suite.", tags: ["benchmark"] });
      await tool.execute("test", { action: "reflect", title: "Reflection", limit: 1 });
      const verified = await tool.execute("test", { action: "verify" });
      expect((verified.details as { valid: boolean; count: number }).valid).toBe(true);
      expect((verified.details as { count: number }).count).toBe(2);
      const checkpoint = await tool.execute("test", { action: "checkpoint" });
      expect((checkpoint.details as { checkpoint: { signature: string } }).checkpoint.signature.length).toBeGreaterThan(20);
      const exported = await tool.execute("test", { action: "export", exportPath: "exports/journal.jsonl" });
      const output = (exported.details as { output: string }).output;
      expect((await readFile(output, "utf8")).split("\n").filter(Boolean)).toHaveLength(2);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("detects tampering and blocks path escape", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "evez-journal-tamper-"));
    try {
      const tool = createEvezSelfJournalTool(api(workspace));
      await tool.execute("test", { action: "write", kind: "failure", title: "Synthetic failure", content: "A test failure was recorded." });
      const journal = path.join(workspace, ".evez", "self-journal.jsonl");
      const raw = await readFile(journal, "utf8");
      await writeFile(journal, raw.replace("Synthetic failure", "Altered failure"), "utf8");
      const verified = await tool.execute("test", { action: "verify" });
      expect((verified.details as { valid: boolean }).valid).toBe(false);
      await expect(tool.execute("test", { action: "export", exportPath: "../../outside.jsonl" })).rejects.toThrow("inside the workspace");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
