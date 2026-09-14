import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { Type } from "@sinclair/typebox";

import type { OpenClawPluginApi } from "../../../src/plugins/types.js";
import { createEvezContextBrokerTool } from "./evez-context-broker.js";
import { createEvezJourneyTool } from "./evez-platform-tools.js";
import { createEvezMediaSpineTool } from "./evez-media-spine.js";
import { createEvezWorkbenchTool } from "./evez-workbench.js";

type OperationStatus = "preview" | "approved" | "executed" | "verified" | "rolled-back";
type Actuation = {
  operationId: string;
  asset: { assetId: string; kind: string; sensitivity?: string };
  action: string;
  impact: "low" | "medium" | "high" | "critical";
  status: OperationStatus;
  approvalRequired: boolean;
  createdAt: string;
  updatedAt: string;
  input?: Record<string, unknown>;
  output?: unknown;
  rollback?: string;
};
type ActuationState = { version: 1; operations: Actuation[] };

const assetSchema = Type.Object({
  assetId: Type.String({ minLength: 1 }),
  kind: Type.String({ minLength: 1 }),
  sensitivity: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
});

export const ActuateParameters = Type.Object({
  action: Type.Union([Type.Literal("inspect"), Type.Literal("recommend"), Type.Literal("preview"), Type.Literal("execute"), Type.Literal("verify"), Type.Literal("rollback")]),
  asset: Type.Optional(assetSchema),
  operation: Type.Optional(Type.String()),
  operationId: Type.Optional(Type.String()),
  input: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  approval: Type.Optional(Type.Literal("user-approved")),
});

function fileFor(api: OpenClawPluginApi): string {
  const workspace = api.config?.agents?.defaults?.workspace ?? process.cwd();
  return path.join(workspace, ".evez", "actuations.json");
}

async function load(file: string): Promise<ActuationState> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as ActuationState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, operations: [] };
    }
    throw error;
  }
}

async function save(file: string, state: ActuationState): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(state)}\n`, "utf8");
}

function runtimeInventory(api: OpenClawPluginApi): Record<string, string[]> {
  return {
    runtimeNamespaces: Object.keys(api.runtime),
    mediaCapabilities: Object.keys(api.runtime.media),
    channelCapabilities: Object.keys(api.runtime.channel),
    safeSystemCapabilities: ["enqueueSystemEvent", "runCommandWithTimeout"],
    note: ["Connector-specific send/write actions remain behind their native OpenClaw tools and authorization checks."],
  };
}

function capabilities(kind: string): string[] {
  const common = ["inspect", "recommend", "preview", "verify"];
  const byKind: Record<string, string[]> = {
    document: ["context-index", "workbench-add"],
    audio: ["media-register", "context-index"],
    video: ["media-register", "context-index"],
    image: ["media-register", "context-index"],
    task: ["workbench-add", "journey-record"],
    repository: ["inspect", "workbench-add", "journey-record"],
    server: ["inspect", "workbench-add", "journey-record"],
    model: ["model-probe", "workbench-add"],
    email: ["inspect", "workbench-add"],
    calendar: ["inspect", "workbench-add"],
  };
  return [...new Set([...common, ...(byKind[kind] ?? [])])];
}

function impactFor(operation: string): Actuation["impact"] {
  if (["media-register", "context-index", "workbench-add", "journey-record", "model-probe"].includes(operation)) {
    return "low";
  }
  if (operation === "inspect") {
    return "low";
  }
  return "high";
}

export function createEvezActuateTool(api: OpenClawPluginApi) {
  return {
    name: "evez-actuate",
    description: "Inspect assets, recommend useful actions, create previews, and execute only approved low-impact EVEZ-local operations with verification and rollback records.",
    parameters: ActuateParameters,
    async execute(_id: string, raw: Record<string, unknown>) {
      const file = fileFor(api);
      const state = await load(file);
      const action = raw.action;
      const asset = raw.asset as { assetId: string; kind: string; sensitivity?: string } | undefined;

      if (action === "inspect") {
        if (!asset) {
          throw new Error("asset required for inspect");
        }
        const result = { action, asset, availableCapabilities: capabilities(asset.kind), runtime: runtimeInventory(api), boundaries: ["No action is executed by inspect.", "External connector writes remain behind native OpenClaw tools.", "Sensitive or high-impact operations require their own approval flow."] };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      }

      if (action === "recommend") {
        if (!asset) {
          throw new Error("asset required for recommend");
        }
        const recommended = asset.kind === "task" ? "workbench-add" : asset.kind === "document" ? "context-index" : ["audio", "video", "image"].includes(asset.kind) ? "media-register" : "inspect";
        const result = { action, asset, recommendation: { operation: recommended, impact: impactFor(recommended), rationale: "Choose the smallest reversible operation that increases understanding before execution." } };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      }

      if (action === "preview") {
        if (!asset || typeof raw.operation !== "string") {
          throw new Error("asset and operation required for preview");
        }
        if (!capabilities(asset.kind).includes(raw.operation)) {
          throw new Error(`operation not available for asset kind: ${asset.kind}`);
        }
        const now = new Date().toISOString();
        const operation: Actuation = {
          operationId: `op-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
          asset,
          action: raw.operation,
          impact: impactFor(raw.operation),
          status: "preview",
          approvalRequired: true,
          createdAt: now,
          updatedAt: now,
          input: raw.input as Record<string, unknown> | undefined,
          rollback: "Restore the prior .evez state snapshot or remove the operation's derived record.",
        };
        state.operations.push(operation);
        await save(file, state);
        const result = { action, operation, exactApproval: "user-approved", executionBoundary: "Only the named local EVEZ operation will run; no connector send, publish, delete, billing, security, or credential change is implied." };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      }

      const operationId = String(raw.operationId ?? "");
      const operation = state.operations.find((candidate) => candidate.operationId === operationId);
      if (!operation) {
        throw new Error(`operation not found: ${operationId}`);
      }
      if (action === "execute") {
        if (raw.approval !== "user-approved") {
          throw new Error("explicit user-approved approval is required for execution");
        }
        if (operation.impact !== "low") {
          throw new Error("only low-impact local operations are executable by evez-actuate");
        }
        const input = operation.input ?? {};
        let result: unknown;
        if (operation.action === "context-index") {
          result = await createEvezContextBrokerTool(api).execute(operationId, { action: "ingest", ...input });
        } else if (operation.action === "media-register") {
          result = await createEvezMediaSpineTool(api).execute(operationId, { action: "register", ...input });
        } else if (operation.action === "workbench-add") {
          result = await createEvezWorkbenchTool(api).execute(operationId, { action: "add", ...input });
        } else if (operation.action === "journey-record") {
          result = await createEvezJourneyTool(api).execute(operationId, { action: "record", ...input });
        } else {
          result = { status: "no-op", reason: `No local executor is registered for ${operation.action}` };
        }
        operation.status = "executed";
        operation.output = result;
        operation.updatedAt = new Date().toISOString();
        await save(file, state);
        return { content: [{ type: "text", text: JSON.stringify({ action, operation }, null, 2) }], details: { action, operation } };
      }

      if (action === "verify") {
        const result = { action, operationId, status: operation.status, verified: operation.status === "executed" || operation.status === "verified", outputRecorded: operation.output !== undefined, rollback: operation.rollback };
        if (result.verified) {
          operation.status = "verified";
        }
        operation.updatedAt = new Date().toISOString();
        await save(file, state);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
      }

      operation.status = "rolled-back";
      operation.updatedAt = new Date().toISOString();
      await save(file, state);
      const result = { action, operationId, status: operation.status, note: "The actuator marked the operation rolled-back. Derived local records require operation-specific restoration if they were already written." };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    },
  };
}
