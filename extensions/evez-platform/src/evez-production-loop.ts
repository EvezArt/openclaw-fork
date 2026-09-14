import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { Type } from "@sinclair/typebox";

import type { OpenClawPluginApi } from "../../../src/plugins/types.js";

type JobKind = "code" | "research" | "paper";
type JobStatus = "pending" | "running" | "completed" | "failed";
type Job = { jobId: string; kind: JobKind; title: string; input: Record<string, unknown>; status: JobStatus; attempts: number; maxAttempts: number; createdAt: string; updatedAt: string; output?: string; error?: string };
type LoopState = { version: 1; jobs: Job[]; lastCheckpoint?: { hash: string; signature: string; publicKey: string; createdAt: string } };

export const ProductionLoopParameters = Type.Object({
  action: Type.Union([Type.Literal("enqueue"), Type.Literal("tick"), Type.Literal("status"), Type.Literal("recover"), Type.Literal("checkpoint")]),
  kind: Type.Optional(Type.Union([Type.Literal("code"), Type.Literal("research"), Type.Literal("paper")])),
  title: Type.Optional(Type.String()),
  input: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  maxJobs: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
  maxAttempts: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
});

function root(api: OpenClawPluginApi): string {
  return path.join(api.config?.agents?.defaults?.workspace ?? process.cwd(), ".evez");
}
function stateFile(api: OpenClawPluginApi): string { return path.join(root(api), "production-loop.json"); }
function keyFile(api: OpenClawPluginApi): string { return path.join(root(api), "production-signing-key.json"); }

async function load(api: OpenClawPluginApi): Promise<LoopState> {
  try { return JSON.parse(await fs.readFile(stateFile(api), "utf8")) as LoopState; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, jobs: [] };
    }
    throw error;
  }
}
async function save(api: OpenClawPluginApi, state: LoopState): Promise<void> {
  await fs.mkdir(root(api), { recursive: true });
  await fs.writeFile(stateFile(api), `${JSON.stringify(state)}\n`, "utf8");
}
async function signingKey(api: OpenClawPluginApi): Promise<{ privateKey: string; publicKey: string }> {
  try { return JSON.parse(await fs.readFile(keyFile(api), "utf8")) as { privateKey: string; publicKey: string }; } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    const pair = crypto.generateKeyPairSync("ed25519");
    const keys = { privateKey: pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString(), publicKey: pair.publicKey.export({ format: "pem", type: "spki" }).toString() };
    await fs.mkdir(root(api), { recursive: true, mode: 0o700 });
    await fs.writeFile(keyFile(api), `${JSON.stringify(keys)}\n`, { encoding: "utf8", mode: 0o600 });
    return keys;
  }
}
function stable(value: unknown): string { return JSON.stringify(value); }

async function writePaper(api: OpenClawPluginApi, job: Job): Promise<string> {
  const input = job.input;
  const title = String(input.title ?? job.title);
  const thesis = String(input.thesis ?? "This paper states a testable hypothesis and identifies the evidence required to evaluate it.");
  const sources = Array.isArray(input.sources) ? input.sources.filter((source): source is string => typeof source === "string") : [];
  const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || job.jobId;
  const file = path.join(root(api), "papers", `${safeName}-${job.jobId}.md`);
  const references = sources.length ? sources.map((source, index) => `[${index + 1}]: ${source} "Source supplied to EVEZ"`).join("\n") : "No external sources supplied. This is a research scaffold, not a verified finding.";
  const content = `# ${title}\n\n**Status:** Evidence-seeking draft\n**Job:** ${job.jobId}\n**Generated:** ${new Date().toISOString()}\n\n## Abstract\n\n${thesis}\n\n## Research question\n\nWhat evidence would support, weaken, or falsify this thesis?\n\n## Method\n\nThis draft separates observations, interpretations, and proposed tests. It does not convert the prompt into evidence. Each consequential claim must be linked to an attributable source, timestamp, or reproducible experiment before publication.\n\n## Evidence ledger\n\n| Claim | Evidence reference | Status | Confidence |\n|---|---|---|---|\n| ${thesis} | ${sources.length ? sources.map((_, index) => `[${index + 1}]`).join(" ") : "None supplied"} | Unverified draft | Not assigned |\n\n## Limitations\n\nThe draft has not been independently reviewed. It may contain incomplete sources, selection bias, stale information, or unresolved contradictions.\n\n## Next experiments\n\n1. Gather primary sources and record access dates.\n2. Add at least one plausible disconfirming source.\n3. Reproduce the key measurement or analysis.\n4. Run Mildred verification before any consequential decision or publication.\n\n## References\n\n${references}\n`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
  return file;
}

async function runJob(api: OpenClawPluginApi, job: Job): Promise<string> {
  if (job.kind === "paper") {
    return await writePaper(api, job);
  }
  if (job.kind === "research") {
    return `Research brief queued for evidence collection: ${job.title}`;
  }
  return `Implementation brief queued for benchmarked coding: ${job.title}`;
}

export function createEvezProductionLoopTool(api: OpenClawPluginApi) {
  return {
    name: "evez-production-loop",
    description: "A bounded, restartable EVEZ production loop for coding briefs, evidence-seeking research, paper scaffolds, checkpoints, and recovery.",
    parameters: ProductionLoopParameters,
    async execute(_id: string, raw: Record<string, unknown>) {
      const state = await load(api);
      const action = raw.action;
      if (action === "enqueue") {
        if (typeof raw.kind !== "string" || typeof raw.title !== "string") {
          throw new Error("kind and title are required for enqueue");
        }
        const now = new Date().toISOString();
        const job: Job = { jobId: `job-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`, kind: raw.kind as JobKind, title: raw.title, input: (raw.input as Record<string, unknown> | undefined) ?? {}, status: "pending", attempts: 0, maxAttempts: typeof raw.maxAttempts === "number" ? raw.maxAttempts : 3, createdAt: now, updatedAt: now };
        state.jobs.push(job);
        await save(api, state);
        return { content: [{ type: "text", text: JSON.stringify({ action, job }, null, 2) }], details: { action, job } };
      }
      if (action === "status") {
        const result = { action, stateFile: stateFile(api), jobs: state.jobs, lastCheckpoint: state.lastCheckpoint };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      }
      if (action === "recover") {
        const now = new Date().toISOString();
        const recovered = state.jobs.filter((job) => job.status === "running").map((job) => { job.status = job.attempts < job.maxAttempts ? "pending" : "failed"; job.updatedAt = now; return job.jobId; });
        await save(api, state);
        const result = { action, recovered };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      }
      if (action === "checkpoint") {
        const keys = await signingKey(api);
        const hash = crypto.createHash("sha256").update(stable({ version: state.version, jobs: state.jobs })).digest("hex");
        const signature = crypto.sign(null, Buffer.from(hash), keys.privateKey).toString("base64");
        state.lastCheckpoint = { hash, signature, publicKey: keys.publicKey, createdAt: new Date().toISOString() };
        await save(api, state);
        const result = { action, checkpoint: state.lastCheckpoint, note: "This signs the local checkpoint; it is not a claim of external certification or authorship." };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      }
      const limit = typeof raw.maxJobs === "number" ? raw.maxJobs : 1;
      const processed: Array<{ jobId: string; status: JobStatus; output?: string; error?: string }> = [];
      for (const job of state.jobs.filter((candidate) => candidate.status === "pending").slice(0, limit)) {
        job.status = "running";
        job.attempts += 1;
        job.updatedAt = new Date().toISOString();
        try {
          job.output = await runJob(api, job);
          job.status = "completed";
        } catch (error) {
          job.error = error instanceof Error ? error.message : String(error);
          job.status = job.attempts < job.maxAttempts ? "pending" : "failed";
        }
        job.updatedAt = new Date().toISOString();
        processed.push({ jobId: job.jobId, status: job.status, output: job.output, error: job.error });
      }
      await save(api, state);
      const result = { action, processed, remaining: state.jobs.filter((job) => job.status === "pending").length, note: "Each tick is bounded. Run it from a supervised scheduler or worker; do not create an unbounded self-spawning loop." };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    },
  };
}
