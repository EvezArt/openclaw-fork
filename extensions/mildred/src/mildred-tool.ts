import crypto from "node:crypto";

import { Type } from "@sinclair/typebox";

import type { OpenClawPluginApi } from "../../../src/plugins/types.js";

type Evidence = {
  id: string;
  source: string;
  text: string;
  supports?: string[];
  contradicts?: string[];
  observedAt?: string;
  reliability?: number;
};

type Claim = {
  id: string;
  text: string;
  importance?: "low" | "medium" | "high";
};

type MildredInput = {
  question: string;
  claims: Claim[];
  evidence: Evidence[];
  abstentionThreshold?: number;
};

type Assessment = {
  claimId: string;
  text: string;
  status: "supported" | "mixed" | "unsupported" | "unassessed";
  confidence: number;
  supportingEvidence: string[];
  contradictingEvidence: string[];
  gaps: string[];
};

const evidenceItem = Type.Object({
  id: Type.String({ minLength: 1 }),
  source: Type.String({ minLength: 1 }),
  text: Type.String({ minLength: 1 }),
  supports: Type.Optional(Type.Array(Type.String())),
  contradicts: Type.Optional(Type.Array(Type.String())),
  observedAt: Type.Optional(Type.String()),
  reliability: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
});

const claimItem = Type.Object({
  id: Type.String({ minLength: 1 }),
  text: Type.String({ minLength: 1 }),
  importance: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")])),
});

export const MildredParameters = Type.Object({
  question: Type.String({ minLength: 1, description: "Question being investigated." }),
  claims: Type.Array(claimItem, { minItems: 1, description: "Atomic claims to assess." }),
  evidence: Type.Array(evidenceItem, { description: "Evidence records with explicit provenance." }),
  abstentionThreshold: Type.Optional(
    Type.Number({ minimum: 0, maximum: 1, description: "Minimum overall confidence required to answer." }),
  ),
});

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function bundleHash(input: MildredInput): string {
  const canonical = JSON.stringify({
    question: input.question,
    claims: input.claims.toSorted((a, b) => a.id.localeCompare(b.id)),
    evidence: input.evidence.toSorted((a, b) => a.id.localeCompare(b.id)),
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

function assessClaim(claim: Claim, evidence: Evidence[]): Assessment {
  const supporting = evidence.filter((item) => item.supports?.includes(claim.id));
  const contradicting = evidence.filter((item) => item.contradicts?.includes(claim.id));
  const supportWeight = supporting.reduce((sum, item) => sum + (item.reliability ?? 0.5), 0);
  const contradictionWeight = contradicting.reduce((sum, item) => sum + (item.reliability ?? 0.5), 0);
  const total = supportWeight + contradictionWeight;
  const confidence = total === 0 ? 0 : clamp(Math.abs(supportWeight - contradictionWeight) / total);
  const status =
    total === 0
      ? "unassessed"
      : supportWeight > contradictionWeight && confidence >= 0.2
        ? "supported"
        : contradictionWeight > supportWeight && confidence >= 0.2
          ? "unsupported"
          : "mixed";

  const gaps: string[] = [];
  if (total === 0) {
    gaps.push("No evidence explicitly supports or contradicts this claim.");
  }
  if (supporting.length === 0) {
    gaps.push("No supporting source is attached.");
  }
  if (contradicting.length === 0) {
    gaps.push("No independent contradiction check is attached.");
  }

  return {
    claimId: claim.id,
    text: claim.text,
    status,
    confidence: Number(confidence.toFixed(3)),
    supportingEvidence: supporting.map((item) => item.id),
    contradictingEvidence: contradicting.map((item) => item.id),
    gaps,
  };
}

export function createMildredTool(_api: OpenClawPluginApi) {
  return {
    name: "mildred-verify",
    description:
      "Mildred: evidence-first verification for consequential answers. Assess atomic claims against explicitly linked evidence, expose contradictions and gaps, hash the evidence bundle, and abstain when confidence is insufficient. This tool never treats self-reference as evidence.",
    parameters: MildredParameters,
    async execute(_id: string, raw: Record<string, unknown>) {
      const input = raw as unknown as MildredInput;
      const claimIds = new Set(input.claims.map((claim) => claim.id));
      const evidenceIds = new Set<string>();
      const duplicateClaimIds = input.claims.filter(
        (claim, index, all) => all.findIndex((candidate) => candidate.id === claim.id) !== index,
      );
      if (duplicateClaimIds.length > 0) {
        throw new Error("claim ids must be unique");
      }

      for (const item of input.evidence) {
        if (evidenceIds.has(item.id)) {
          throw new Error(`evidence ids must be unique: ${item.id}`);
        }
        evidenceIds.add(item.id);
        for (const id of [...(item.supports ?? []), ...(item.contradicts ?? [])]) {
          if (!claimIds.has(id)) {
            throw new Error(`evidence ${item.id} references unknown claim ${id}`);
          }
        }
      }

      const assessments = input.claims.map((claim) => assessClaim(claim, input.evidence));
      const weightedClaims = assessments.filter((assessment) => {
        const claim = input.claims.find((item) => item.id === assessment.claimId);
        return claim?.importance === "high";
      });
      const scored = weightedClaims.length > 0 ? weightedClaims : assessments;
      const overallConfidence = scored.length
        ? Number((scored.reduce((sum, item) => sum + item.confidence, 0) / scored.length).toFixed(3))
        : 0;
      const threshold = input.abstentionThreshold ?? 0.7;
      const unresolved = assessments.filter((item) => item.status === "mixed" || item.status === "unassessed");
      const contradictions = assessments.filter((item) => item.contradictingEvidence.length > 0);
      const answerability = overallConfidence >= threshold && unresolved.length === 0 ? "answerable" : "abstain";
      const nextActions = unique([
        ...(answerability === "abstain" ? ["Collect an independent source for each unresolved claim."] : []),
        ...(contradictions.length > 0 ? ["Resolve contradictory evidence before taking consequential action."] : []),
        ...(input.evidence.length === 0 ? ["Attach dated, attributable evidence before answering."] : []),
      ]);

      const result = {
        agent: "mildred",
        version: "0.1.0",
        question: input.question,
        answerability,
        overallConfidence,
        abstentionThreshold: threshold,
        assessments,
        evidenceLedger: input.evidence.map((item) => ({
          id: item.id,
          source: item.source,
          observedAt: item.observedAt ?? null,
          reliability: item.reliability ?? 0.5,
        })),
        contradictions: contradictions.map((item) => item.claimId),
        nextActions,
        evidenceBundleSha256: bundleHash(input),
        method: "explicit claim-evidence links; reliability-weighted support; fail-closed abstention",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  };
}
