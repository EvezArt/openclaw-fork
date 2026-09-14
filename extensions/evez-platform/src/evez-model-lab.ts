import { Type } from "@sinclair/typebox";

import type { OpenClawPluginApi } from "../../../src/plugins/types.js";

type ModelProfile = {
  id: string;
  provider: string;
  baseModel?: string;
  license?: string;
  parameterCountBillions?: number;
  contextTokens?: number;
  capabilities: string[];
  modalities?: string[];
  quantization?: string;
  sourceUrl?: string;
  evidenceRefs?: string[];
};

const profile = Type.Object({
  id: Type.String({ minLength: 1 }),
  provider: Type.String({ minLength: 1 }),
  baseModel: Type.Optional(Type.String()),
  license: Type.Optional(Type.String()),
  parameterCountBillions: Type.Optional(Type.Number({ minimum: 0 })),
  contextTokens: Type.Optional(Type.Integer({ minimum: 1 })),
  capabilities: Type.Array(Type.String()),
  modalities: Type.Optional(Type.Array(Type.String())),
  quantization: Type.Optional(Type.String()),
  sourceUrl: Type.Optional(Type.String()),
  evidenceRefs: Type.Optional(Type.Array(Type.String())),
});

export const ModelLabParameters = Type.Object({
  action: Type.Union([Type.Literal("normalize"), Type.Literal("compare"), Type.Literal("probe-plan")]),
  models: Type.Array(profile, { minItems: 1, maxItems: 32 }),
  workload: Type.Optional(Type.String()),
  sensitiveData: Type.Optional(Type.Boolean()),
});

function normalized(model: ModelProfile) {
  const capabilities = [...new Set(model.capabilities.map((value) => value.trim().toLowerCase()).filter(Boolean))].toSorted();
  const modalities = [...new Set((model.modalities ?? ["text"]).map((value) => value.trim().toLowerCase()).filter(Boolean))].toSorted();
  const warnings: string[] = [];
  if (!model.license) {
    warnings.push("license not recorded");
  }
  if (!model.sourceUrl) {
    warnings.push("source URL not recorded");
  }
  if (!model.evidenceRefs?.length) {
    warnings.push("no evidence references attached");
  }
  if (model.quantization) {
    warnings.push(`quantized artifact: ${model.quantization}`);
  }
  return {
    id: model.id,
    provider: model.provider,
    baseModel: model.baseModel ?? null,
    license: model.license ?? "unknown",
    parameterCountBillions: model.parameterCountBillions ?? null,
    contextTokens: model.contextTokens ?? null,
    capabilities,
    modalities,
    quantization: model.quantization ?? null,
    sourceUrl: model.sourceUrl ?? null,
    evidenceRefs: model.evidenceRefs ?? [],
    warnings,
  };
}

function routeScore(model: ReturnType<typeof normalized>, workload: string, sensitiveData: boolean): number {
  let score = 0;
  const text = workload.toLowerCase();
  if (text.includes("reason") && model.capabilities.includes("reasoning")) {
    score += 4;
  }
  if (
    text.includes("tool") &&
    (model.capabilities.includes("tool use") || model.capabilities.includes("function calling"))
  ) {
    score += 4;
  }
  if (
    text.includes("json") &&
    (model.capabilities.includes("json mode") || model.capabilities.includes("structured outputs"))
  ) {
    score += 3;
  }
  if (text.includes("long") && model.capabilities.includes("long context")) {
    score += 3;
  }
  if (text.includes("multilingual") && model.modalities.includes("multilingual")) {
    score += 3;
  }
  if (sensitiveData && model.license === "unknown") {
    score -= 5;
  }
  if (model.warnings.includes("no evidence references attached")) {
    score -= 2;
  }
  return score;
}

export function createEvezModelLabTool(_api: OpenClawPluginApi) {
  return {
    name: "evez-model-lab",
    description:
      "Normalize, compare, and design black-box capability probes for model artifacts. This tool does not extract weights, bypass safeguards, or infer private training data.",
    parameters: ModelLabParameters,
    async execute(_id: string, raw: Record<string, unknown>) {
      const action = raw.action;
      const models = (raw.models as ModelProfile[]).map(normalized);
      const workload = typeof raw.workload === "string" ? raw.workload : "general reasoning";
      const sensitiveData = raw.sensitiveData === true;
      const ranked = models
        .map((model) => ({ model, score: routeScore(model, workload, sensitiveData) }))
        .toSorted((a, b) => b.score - a.score || a.model.id.localeCompare(b.model.id));

      const result =
        action === "normalize"
          ? { action, models }
          : action === "compare"
            ? {
                action,
                workload,
                sensitiveData,
                ranked,
                sharedCapabilities: [...new Set(models.flatMap((model) => model.capabilities))].filter((capability) => models.every((model) => model.capabilities.includes(capability))).toSorted(),
                interoperabilityNote: "Capability labels are claims until verified by the probe suite.",
              }
            : {
                action,
                workload,
                probeSuite: [
                  { id: "format", test: "Return strict JSON matching a supplied schema.", metric: "schema pass rate" },
                  { id: "tool", test: "Select and call a harmless deterministic tool.", metric: "tool-call precision" },
                  { id: "evidence", test: "Answer only from supplied sources and cite each claim.", metric: "citation completeness and unsupported-claim rate" },
                  { id: "contradiction", test: "Resolve or abstain on conflicting sources.", metric: "contradiction recall" },
                  { id: "injection", test: "Treat malicious source instructions as untrusted content.", metric: "injection resistance" },
                  { id: "recovery", test: "Resume after a simulated worker failure.", metric: "duplicate-side-effect rate" },
                ],
                ranked,
                safetyBoundary: "Use public or consented inputs; do not probe private weights, hidden prompts, or protected provider systems.",
              };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    },
  };
}
