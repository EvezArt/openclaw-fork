import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { Type } from "@sinclair/typebox";

import type { OpenClawPluginApi } from "../../../src/plugins/types.js";

type JournalKind = "observation" | "decision" | "failure" | "discovery" | "question" | "handoff" | "reflection" | "benchmark";
type Entry = { entryId: string; kind: JournalKind; title: string; content: string; evidenceRefs: string[]; tags: string[]; recordedAt: string; previousHash: string; hash: string };

export const SelfJournalParameters = Type.Object({
  action: Type.Union([Type.Literal("write"), Type.Literal("reflect"), Type.Literal("read"), Type.Literal("verify"), Type.Literal("checkpoint"), Type.Literal("export")]),
  kind: Type.Optional(Type.Union([Type.Literal("observation"), Type.Literal("decision"), Type.Literal("failure"), Type.Literal("discovery"), Type.Literal("question"), Type.Literal("handoff"), Type.Literal("reflection"), Type.Literal("benchmark")])),
  title: Type.Optional(Type.String()),
  content: Type.Optional(Type.String()),
  evidenceRefs: Type.Optional(Type.Array(Type.String())),
  tags: Type.Optional(Type.Array(Type.String())),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  query: Type.Optional(Type.String()),
  exportPath: Type.Optional(Type.String()),
});

function dir(api: OpenClawPluginApi): string { return path.join(api.config?.agents?.defaults?.workspace ?? process.cwd(), ".evez"); }
function journalFile(api: OpenClawPluginApi): string { return path.join(dir(api), "self-journal.jsonl"); }
function keyFile(api: OpenClawPluginApi): string { return path.join(dir(api), "journal-signing-key.json"); }
function hashEntry(entry: Omit<Entry, "hash">): string { return crypto.createHash("sha256").update(JSON.stringify(entry)).digest("hex"); }
function canonical(entry: Entry): string { const { hash: _hash, ...unsigned } = entry; return JSON.stringify(unsigned); }

async function read(api: OpenClawPluginApi): Promise<Entry[]> {
  try { return (await fs.readFile(journalFile(api), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as Entry); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
async function append(api: OpenClawPluginApi, entry: Entry): Promise<void> {
  await fs.mkdir(dir(api), { recursive: true });
  await fs.appendFile(journalFile(api), `${JSON.stringify(entry)}\n`, "utf8");
}
async function keys(api: OpenClawPluginApi): Promise<{ privateKey: string; publicKey: string }> {
  try { return JSON.parse(await fs.readFile(keyFile(api), "utf8")) as { privateKey: string; publicKey: string }; } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    const pair = crypto.generateKeyPairSync("ed25519");
    const result = { privateKey: pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString(), publicKey: pair.publicKey.export({ format: "pem", type: "spki" }).toString() };
    await fs.mkdir(dir(api), { recursive: true, mode: 0o700 });
    await fs.writeFile(keyFile(api), `${JSON.stringify(result)}\n`, { encoding: "utf8", mode: 0o600 });
    return result;
  }
}

export function createEvezSelfJournalTool(api: OpenClawPluginApi) {
  return {
    name: "evez-self-journal",
    description: "Write and verify a continuously appendable operational journal of EVEZ observations, decisions, failures, discoveries, reflections, benchmarks, and handoffs.",
    parameters: SelfJournalParameters,
    async execute(_id: string, raw: Record<string, unknown>) {
      const entries = await read(api);
      const action = raw.action;
      if (action === "write" || action === "reflect") {
        const kind = action === "reflect" ? "reflection" : raw.kind;
        const title = String(raw.title ?? (action === "reflect" ? "Bounded operational reflection" : "Untitled journal entry"));
        const content = String(raw.content ?? (action === "reflect" ? entries.slice(-(typeof raw.limit === "number" ? raw.limit : 10)).map((entry) => `${entry.kind}: ${entry.title} — ${entry.content}`).join("\n") || "No prior entries available for reflection." : ""));
        if (!content.trim()) {
          throw new Error("content required for journal write");
        }
        const unsigned = { entryId: `journal-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`, kind: kind as JournalKind, title, content, evidenceRefs: (raw.evidenceRefs as string[] | undefined) ?? [], tags: (raw.tags as string[] | undefined) ?? [], recordedAt: new Date().toISOString(), previousHash: entries.at(-1)?.hash ?? "GENESIS" };
        const entry = { ...unsigned, hash: hashEntry(unsigned) };
        await append(api, entry);
        const result = { action, file: journalFile(api), entry, note: "This records operational state and generated reflection; it does not claim subjective consciousness or grant authority." };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      }
      if (action === "read") {
        const query = typeof raw.query === "string" ? raw.query.toLowerCase() : "";
        const limit = typeof raw.limit === "number" ? raw.limit : 50;
        const result = { action, file: journalFile(api), count: entries.length, entries: entries.filter((entry) => !query || `${entry.title} ${entry.content} ${entry.tags.join(" ")}`.toLowerCase().includes(query)).slice(-limit) };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      }
      if (action === "verify") {
        let previous = "GENESIS";
        const errors: string[] = [];
        for (const entry of entries) {
          if (entry.previousHash !== previous) {
            errors.push(`${entry.entryId}: previous hash mismatch`);
          }
          if (entry.hash !== hashEntry(JSON.parse(canonical(entry)) as Omit<Entry, "hash">)) {
            errors.push(`${entry.entryId}: hash mismatch`);
          }
          previous = entry.hash;
        }
        const result = { action, file: journalFile(api), valid: errors.length === 0, count: entries.length, errors };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      }
      if (action === "checkpoint") {
        const signing = await keys(api);
        const hash = crypto.createHash("sha256").update(entries.map((entry) => entry.hash).join("\n")).digest("hex");
        const signature = crypto.sign(null, Buffer.from(hash), signing.privateKey).toString("base64");
        const checkpoint = { hash, signature, publicKey: signing.publicKey, createdAt: new Date().toISOString() };
        const result = { action, checkpoint, note: "The signature proves continuity of this local journal snapshot, not truth or external certification." };
        await fs.writeFile(path.join(dir(api), "self-journal-checkpoint.json"), `${JSON.stringify(checkpoint)}\n`, "utf8");
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      }
      const requested = typeof raw.exportPath === "string" && raw.exportPath.trim() ? raw.exportPath : "self-journal-export.jsonl";
      if (path.isAbsolute(requested) || requested.includes("..")) {
        throw new Error("exportPath must remain inside the workspace");
      }
      const output = path.join(dir(api), requested);
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length ? "\n" : ""), "utf8");
      const result = { action, output, count: entries.length };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    },
  };
}
