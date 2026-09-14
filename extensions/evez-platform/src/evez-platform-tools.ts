import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { Type } from "@sinclair/typebox";

import type { OpenClawPluginApi } from "../../../src/plugins/types.js";

type ResearchLane = {
  id: string;
  role: "scout" | "skeptic" | "analyst" | "verifier";
  objective: string;
  deliverables: string[];
  independenceRule: string;
};

type JourneyEvent = {
  type: "milestone" | "failure" | "decision" | "discovery" | "handoff";
  title: string;
  summary: string;
  evidenceRefs?: string[];
  actor?: string;
  tags?: string[];
};

type StoredJourneyEvent = JourneyEvent & {
  eventId: string;
  recordedAt: string;
  previousHash: string;
  hash: string;
};

const roleLanes: Array<{ role: ResearchLane["role"]; objective: string; deliverables: string[] }> = [
  {
    role: "scout",
    objective: "Find primary sources, definitions, measurements, and competing explanations.",
    deliverables: ["source ledger", "key excerpts", "open questions"],
  },
  {
    role: "skeptic",
    objective: "Try to falsify the leading interpretation and search for disconfirming evidence.",
    deliverables: ["counterevidence", "confounders", "failure modes"],
  },
  {
    role: "analyst",
    objective: "Build a structured model of the evidence, assumptions, dependencies, and uncertainty.",
    deliverables: ["claim graph", "assumption register", "confidence analysis"],
  },
  {
    role: "verifier",
    objective: "Check citations, dates, calculations, reproducibility, and whether conclusions follow from evidence.",
    deliverables: ["verification report", "contradiction list", "release gate"],
  },
];

const researchParameters = Type.Object({
  question: Type.String({ minLength: 1, description: "Question or objective to investigate." }),
  context: Type.Optional(Type.String({ description: "Known context, constraints, or prior work." })),
  maxLanes: Type.Optional(Type.Integer({ minimum: 1, maximum: 12 })),
  consequential: Type.Optional(Type.Boolean({ description: "Whether the output could affect people, systems, or scarce resources." })),
});

const journeyParameters = Type.Object({
  action: Type.Union([
    Type.Literal("record"),
    Type.Literal("list"),
    Type.Literal("verify"),
  ]),
  event: Type.Optional(
    Type.Object({
      type: Type.Union([
        Type.Literal("milestone"),
        Type.Literal("failure"),
        Type.Literal("decision"),
        Type.Literal("discovery"),
        Type.Literal("handoff"),
      ]),
      title: Type.String({ minLength: 1 }),
      summary: Type.String({ minLength: 1 }),
      evidenceRefs: Type.Optional(Type.Array(Type.String())),
      actor: Type.Optional(Type.String()),
      tags: Type.Optional(Type.Array(Type.String())),
    }),
  ),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalEvent(event: StoredJourneyEvent): string {
  return JSON.stringify({
    eventId: event.eventId,
    recordedAt: event.recordedAt,
    type: event.type,
    title: event.title,
    summary: event.summary,
    evidenceRefs: event.evidenceRefs ?? [],
    actor: event.actor ?? null,
    tags: event.tags ?? [],
    previousHash: event.previousHash,
  });
}

function createLanes(question: string, maxLanes: number): ResearchLane[] {
  const selected = roleLanes.slice(0, Math.min(maxLanes, roleLanes.length));
  return selected.map((lane, index) => ({
    id: `${lane.role}-${index + 1}`,
    role: lane.role,
    objective: `${lane.objective} Research question: ${question}`,
    deliverables: lane.deliverables,
    independenceRule:
      lane.role === "verifier"
        ? "Do not accept another lane's conclusion without checking its source references."
        : "Report observations and uncertainty separately from interpretation.",
  }));
}

function workspaceDir(api: OpenClawPluginApi): string {
  return api.config?.agents?.defaults?.workspace ?? process.cwd();
}

function journeyFile(api: OpenClawPluginApi): string {
  const configured = (api.pluginConfig as { journeyPath?: unknown } | undefined)?.journeyPath;
  if (typeof configured === "string" && configured.trim()) {
    return path.resolve(workspaceDir(api), configured);
  }
  return path.join(workspaceDir(api), ".evez", "journey.jsonl");
}

async function readJourney(file: string): Promise<StoredJourneyEvent[]> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as StoredJourneyEvent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export function createEvezResearchTool(_api: OpenClawPluginApi) {
  return {
    name: "evez-research-plan",
    description:
      "Create a bounded, independent-lane EVEZ research plan with scout, skeptic, analyst, and verifier roles. This plans work; it does not claim that research has been performed.",
    parameters: researchParameters,
    async execute(_id: string, raw: Record<string, unknown>) {
      const question = String(raw.question ?? "").trim();
      if (!question) {
        throw new Error("question required");
      }
      const maxLanes = typeof raw.maxLanes === "number" ? raw.maxLanes : 4;
      const lanes = createLanes(question, maxLanes);
      const consequential = raw.consequential === true;
      const plan = {
        planId: `evez-${sha256(`${question}:${Date.now()}`).slice(0, 16)}`,
        question,
        context: typeof raw.context === "string" ? raw.context : null,
        status: "planned",
        lanes,
        synthesisGate: {
          requiresIndependentVerification: true,
          requiresContradictionReview: true,
          requiresEvidenceLedger: true,
          abstainIfUnresolved: true,
          consequentialActionApproval: consequential,
        },
        modelRouting: {
          scout: "fast long-context model",
          skeptic: "independent reasoning model",
          analyst: "structured synthesis model",
          verifier: "strong verifier model or human reviewer",
        },
        nextStep: "Run each lane independently, attach dated sources, then pass the combined ledger to Mildred before synthesis.",
      };
      return { content: [{ type: "text", text: JSON.stringify(plan, null, 2) }], details: plan };
    },
  };
}

export function createEvezJourneyTool(api: OpenClawPluginApi) {
  return {
    name: "evez-journey",
    description:
      "Record and verify significant EVEZ-OS progress as an append-only, hash-chained journey log. Never invents progress; callers must provide the event and evidence references.",
    parameters: journeyParameters,
    async execute(_id: string, raw: Record<string, unknown>) {
      const action = raw.action;
      const file = journeyFile(api);
      const events = await readJourney(file);

      if (action === "list") {
        const limit = typeof raw.limit === "number" ? raw.limit : 20;
        const result = { file, count: events.length, events: events.slice(-limit) };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      }

      if (action === "verify") {
        let previousHash = "GENESIS";
        const errors: string[] = [];
        for (const event of events) {
          if (event.previousHash !== previousHash) {
            errors.push(`${event.eventId}: previous hash mismatch`);
          }
          if (event.hash !== sha256(canonicalEvent(event))) {
            errors.push(`${event.eventId}: event hash mismatch`);
          }
          previousHash = event.hash;
        }
        const result = { file, valid: errors.length === 0, count: events.length, errors };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      }

      if (!raw.event || typeof raw.event !== "object") {
        throw new Error("event required for record");
      }
      const event = raw.event as JourneyEvent;
      const previousHash = events.at(-1)?.hash ?? "GENESIS";
      const unsigned: StoredJourneyEvent = {
        eventId: `journey-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
        recordedAt: new Date().toISOString(),
        type: event.type,
        title: event.title,
        summary: event.summary,
        evidenceRefs: event.evidenceRefs ?? [],
        actor: event.actor,
        tags: event.tags ?? [],
        previousHash,
        hash: "",
      };
      unsigned.hash = sha256(canonicalEvent(unsigned));
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, `${JSON.stringify(unsigned)}\n`, "utf8");
      const result = { file, recorded: unsigned, chainValid: true };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    },
  };
}
