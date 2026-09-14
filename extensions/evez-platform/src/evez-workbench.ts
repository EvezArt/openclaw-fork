import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { Type } from "@sinclair/typebox";

import type { OpenClawPluginApi } from "../../../src/plugins/types.js";

type TaskStatus = "backlog" | "ready" | "blocked" | "doing" | "done" | "dropped";
type Task = {
  id: string;
  title: string;
  objective?: string;
  status: TaskStatus;
  impact: 1 | 2 | 3 | 4 | 5;
  urgency: 1 | 2 | 3 | 4 | 5;
  energy: "low" | "medium" | "high";
  estimateMinutes: number;
  dueAt?: string;
  dependencies: string[];
  tags: string[];
  nextAction?: string;
  completionEvidence?: string[];
  createdAt: string;
  updatedAt: string;
};

type Event = { id: string; type: "created" | "started" | "completed" | "dropped"; taskId: string; summary: string; at: string; previousHash: string; hash: string };
type Workbench = { version: 1; tasks: Task[]; events: Event[] };

const taskSchema = Type.Object({
  title: Type.String({ minLength: 1 }),
  objective: Type.Optional(Type.String()),
  impact: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
  urgency: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
  energy: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")])),
  estimateMinutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 10080 })),
  dueAt: Type.Optional(Type.String()),
  dependencies: Type.Optional(Type.Array(Type.String())),
  tags: Type.Optional(Type.Array(Type.String())),
  nextAction: Type.Optional(Type.String()),
});

export const WorkbenchParameters = Type.Object({
  action: Type.Union([Type.Literal("add"), Type.Literal("list"), Type.Literal("next"), Type.Literal("start"), Type.Literal("complete"), Type.Literal("drop"), Type.Literal("stats")]),
  task: Type.Optional(taskSchema),
  taskId: Type.Optional(Type.String()),
  completionEvidence: Type.Optional(Type.Array(Type.String())),
  energyAvailable: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")])),
  tag: Type.Optional(Type.String()),
});

function fileFor(api: OpenClawPluginApi): string {
  const workspace = api.config?.agents?.defaults?.workspace ?? process.cwd();
  return path.join(workspace, ".evez", "workbench.json");
}

async function load(file: string): Promise<Workbench> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as Workbench;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, tasks: [], events: [] };
    }
    throw error;
  }
}

async function save(file: string, state: Workbench): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(state)}\n`, "utf8");
}

function hashEvent(event: Omit<Event, "hash">): string {
  return crypto.createHash("sha256").update(JSON.stringify(event)).digest("hex");
}

function ready(task: Task, tasks: Task[]): boolean {
  return task.dependencies.every((id) => tasks.find((candidate) => candidate.id === id)?.status === "done");
}

function score(task: Task, tasks: Task[], energyAvailable: Task["energy"]): number {
  const dependencyBonus = ready(task, tasks) ? 3 : -8;
  const energyBonus = task.energy === energyAvailable ? 2 : task.energy === "low" ? 1 : 0;
  const dueBonus = task.dueAt ? Math.max(0, 5 - Math.ceil((new Date(task.dueAt).getTime() - Date.now()) / 86_400_000)) : 0;
  return task.impact * 4 + task.urgency * 3 + dependencyBonus + energyBonus + dueBonus - Math.ceil(task.estimateMinutes / 60);
}

function appendEvent(state: Workbench, type: Event["type"], taskId: string, summary: string): Event {
  const unsigned = { id: `event-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`, type, taskId, summary, at: new Date().toISOString(), previousHash: state.events.at(-1)?.hash ?? "GENESIS" };
  const event = { ...unsigned, hash: hashEvent(unsigned) };
  state.events.push(event);
  return event;
}

export function createEvezWorkbenchTool(api: OpenClawPluginApi) {
  return {
    name: "evez-workbench",
    description: "A local-first productivity cockpit that turns goals into prioritized, dependency-aware next actions and records completion evidence in a hash-chained history.",
    parameters: WorkbenchParameters,
    async execute(_id: string, raw: Record<string, unknown>) {
      const file = fileFor(api);
      const state = await load(file);
      const action = raw.action;

      if (action === "add") {
        if (!raw.task || typeof raw.task !== "object") {
          throw new Error("task required for add");
        }
        const input = raw.task as Record<string, unknown>;
        const now = new Date().toISOString();
        const task: Task = {
          id: `task-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
          title: String(input.title),
          objective: typeof input.objective === "string" ? input.objective : undefined,
          status: (input.dependencies as string[] | undefined)?.length ? "backlog" : "ready",
          impact: (input.impact as Task["impact"] | undefined) ?? 3,
          urgency: (input.urgency as Task["urgency"] | undefined) ?? 3,
          energy: (input.energy as Task["energy"] | undefined) ?? "medium",
          estimateMinutes: typeof input.estimateMinutes === "number" ? input.estimateMinutes : 30,
          dueAt: typeof input.dueAt === "string" ? input.dueAt : undefined,
          dependencies: (input.dependencies as string[] | undefined) ?? [],
          tags: (input.tags as string[] | undefined) ?? [],
          nextAction: typeof input.nextAction === "string" ? input.nextAction : `Define the smallest observable step for: ${String(input.title)}`,
          completionEvidence: [],
          createdAt: now,
          updatedAt: now,
        };
        state.tasks.push(task);
        appendEvent(state, "created", task.id, task.title);
        await save(file, state);
        return { content: [{ type: "text", text: JSON.stringify({ action, task }, null, 2) }], details: { action, task } };
      }

      if (action === "stats") {
        const result = { action, file, total: state.tasks.length, byStatus: Object.fromEntries(["backlog", "ready", "blocked", "doing", "done", "dropped"].map((status) => [status, state.tasks.filter((task) => task.status === status).length])), eventCount: state.events.length };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      }

      if (action === "list" || action === "next") {
        const energy = (raw.energyAvailable as Task["energy"] | undefined) ?? "medium";
        const tag = typeof raw.tag === "string" ? raw.tag : undefined;
        const candidates = state.tasks.filter((task) => ["backlog", "ready", "doing"].includes(task.status) && ready(task, state.tasks) && (!tag || task.tags.includes(tag)));
        const tasks = candidates.map((task) => ({ task, score: score(task, state.tasks, energy) })).toSorted((a, b) => b.score - a.score || a.task.createdAt.localeCompare(b.task.createdAt));
        const result = { action, energyAvailable: energy, tasks: action === "next" ? tasks.slice(0, 1) : tasks, recommendation: tasks[0] ? { taskId: tasks[0].task.id, nextAction: tasks[0].task.nextAction } : "No ready work. Add a task or unblock a dependency." };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      }

      const taskId = String(raw.taskId ?? "");
      const task = state.tasks.find((candidate) => candidate.id === taskId);
      if (!task) {
        throw new Error(`task not found: ${taskId}`);
      }
      if (action === "start") {
        task.status = "doing";
        task.updatedAt = new Date().toISOString();
        appendEvent(state, "started", task.id, task.title);
      } else if (action === "complete") {
        task.status = "done";
        task.completionEvidence = (raw.completionEvidence as string[] | undefined) ?? [];
        task.updatedAt = new Date().toISOString();
        appendEvent(state, "completed", task.id, task.completionEvidence.join("; ") || task.title);
      } else if (action === "drop") {
        task.status = "dropped";
        task.updatedAt = new Date().toISOString();
        appendEvent(state, "dropped", task.id, task.title);
      }
      await save(file, state);
      const result = { action, task, historyTail: state.events.slice(-3) };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    },
  };
}
