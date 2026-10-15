import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { OpenClawConfig } from "../config/config.js";

export class OpenRouterBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenRouterBudgetError";
  }
}

type Usage = { day: string; spentUsd: number; requests: number };

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function usagePath(): string {
  return path.join(
    process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw"),
    "openrouter-budget.json",
  );
}

function readUsage(): Usage {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const parsed = JSON.parse(fs.readFileSync(usagePath(), "utf8")) as Partial<Usage>;
    if (parsed.day === today) {
      return {
        day: today,
        spentUsd: Number(parsed.spentUsd) || 0,
        requests: Number(parsed.requests) || 0,
      };
    }
  } catch {
    // Missing or malformed usage state is treated as zero, then replaced on write.
  }
  return { day: today, spentUsd: 0, requests: 0 };
}

function writeUsage(usage: Usage): void {
  const file = usagePath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(usage, null, 2) + "\n", { mode: 0o600 });
}

function modelCostUsdPerMillion(
  cfg: OpenClawConfig | undefined,
  model: string,
): { input: number; output: number } {
  const definition = cfg?.models?.providers?.openrouter?.models?.find(
    (candidate) => candidate.id === model,
  );
  return {
    input: (definition?.cost?.input ?? 0) / 1_000_000,
    output: (definition?.cost?.output ?? 0) / 1_000_000,
  };
}

/**
 * Fail-closed policy for OpenRouter. Free models (pricing reported as zero or
 * model ids ending in :free) are allowed. Paid models require explicit opt-in.
 * The guard runs before the provider call, so a denied request cannot spend.
 */
export function assertOpenRouterRequestAllowed(params: {
  cfg?: OpenClawConfig;
  model: string;
  estimatedInputTokens?: number;
}): void {
  const id = params.model.trim();
  const freeById = id.endsWith(":free");
  const cost = modelCostUsdPerMillion(params.cfg, id);
  const estimatedInput = Math.max(0, params.estimatedInputTokens ?? 0);
  const estimatedOutput = numberEnv("OPENROUTER_MAX_OUTPUT_TOKENS", 2048);
  const estimateUsd = estimatedInput * cost.input + estimatedOutput * cost.output;
  const paid = !freeById && estimateUsd > 0;

  if (paid && process.env.OPENROUTER_ALLOW_PAID !== "1") {
    throw new OpenRouterBudgetError(
      `Blocked paid OpenRouter model ${id}. Set OPENROUTER_ALLOW_PAID=1 only after choosing a budget.`,
    );
  }
  const requestCap = numberEnv("OPENROUTER_MAX_REQUEST_USD", 0.05);
  if (paid && estimateUsd > requestCap) {
    throw new OpenRouterBudgetError(
      `Blocked ${id}: estimated request cost $${estimateUsd.toFixed(4)} exceeds OPENROUTER_MAX_REQUEST_USD=$${requestCap.toFixed(4)}.`,
    );
  }
  if (paid) {
    const usage = readUsage();
    const dailyCap = numberEnv("OPENROUTER_DAILY_BUDGET_USD", 1);
    if (usage.spentUsd + estimateUsd > dailyCap) {
      throw new OpenRouterBudgetError(
        `Blocked ${id}: daily OpenRouter budget would exceed $${dailyCap.toFixed(2)}.`,
      );
    }
    usage.spentUsd += estimateUsd;
    usage.requests += 1;
    writeUsage(usage);
  }
}

export function openRouterCostPolicy(): {
  paidOptIn: boolean;
  maxOutputTokens: number;
  maxRequestUsd: number;
  dailyBudgetUsd: number;
} {
  return {
    paidOptIn: process.env.OPENROUTER_ALLOW_PAID === "1",
    maxOutputTokens: numberEnv("OPENROUTER_MAX_OUTPUT_TOKENS", 2048),
    maxRequestUsd: numberEnv("OPENROUTER_MAX_REQUEST_USD", 0.05),
    dailyBudgetUsd: numberEnv("OPENROUTER_DAILY_BUDGET_USD", 1),
  };
}
