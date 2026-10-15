import type { ModelDefinitionConfig } from "../config/types.models.js";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_DEFAULT_CONTEXT_WINDOW = 32768;
export const OPENROUTER_DEFAULT_MAX_TOKENS = 2048;

export type OpenRouterCatalogEntry = {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  max_completion_tokens?: unknown;
  pricing?: {
    prompt?: unknown;
    completion?: unknown;
    input_cache_read?: unknown;
    input_cache_write?: unknown;
  };
  architecture?: { input_modalities?: unknown };
  supported_parameters?: unknown;
};

function finiteNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function isReasoningModel(entry: OpenRouterCatalogEntry): boolean {
  const id = typeof entry.id === "string" ? entry.id.toLowerCase() : "";
  const params = Array.isArray(entry.supported_parameters)
    ? entry.supported_parameters.map(String)
    : [];
  return (
    /reason|thinking|r1|o1|o3|o4|deepseek-r/.test(id) || params.some((p) => /reasoning/i.test(p))
  );
}

function modelDefinition(entry: OpenRouterCatalogEntry): ModelDefinitionConfig | null {
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  if (!id) {
    return null;
  }
  const modalities = Array.isArray(entry.architecture?.input_modalities)
    ? entry.architecture?.input_modalities.map(String)
    : [];
  const prompt = finiteNumber(entry.pricing?.prompt, 0);
  const completion = finiteNumber(entry.pricing?.completion, 0);
  const cacheRead = finiteNumber(entry.pricing?.input_cache_read, 0);
  const cacheWrite = finiteNumber(entry.pricing?.input_cache_write, 0);
  const maxTokens = Math.min(
    finiteNumber(entry.max_completion_tokens, OPENROUTER_DEFAULT_MAX_TOKENS),
    Math.max(1, Number(process.env.OPENROUTER_MAX_OUTPUT_TOKENS ?? OPENROUTER_DEFAULT_MAX_TOKENS)),
  );
  return {
    id,
    name: typeof entry.name === "string" && entry.name.trim() ? entry.name : id,
    reasoning: isReasoningModel(entry),
    input: modalities.some((m) => /image|vision/i.test(m)) ? ["text", "image"] : ["text"],
    cost: {
      input: prompt * 1_000_000,
      output: completion * 1_000_000,
      cacheRead: cacheRead * 1_000_000,
      cacheWrite: cacheWrite * 1_000_000,
    },
    contextWindow: Math.max(
      1024,
      Math.floor(finiteNumber(entry.context_length, OPENROUTER_DEFAULT_CONTEXT_WINDOW)),
    ),
    maxTokens,
  };
}

export function buildOpenRouterModelDefinition(
  entry: OpenRouterCatalogEntry,
): ModelDefinitionConfig | null {
  return modelDefinition(entry);
}

export async function discoverOpenRouterModels(
  params: { apiKey?: string; fetchFn?: typeof fetch } = {},
): Promise<ModelDefinitionConfig[]> {
  const fetchFn = params.fetchFn ?? fetch;
  try {
    const response = await fetchFn(`${OPENROUTER_BASE_URL}/models`, {
      headers: params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : undefined,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return [];
    }
    const payload = (await response.json()) as { data?: OpenRouterCatalogEntry[] };
    return (Array.isArray(payload.data) ? payload.data : [])
      .map(modelDefinition)
      .filter((model): model is ModelDefinitionConfig => Boolean(model));
  } catch {
    return [];
  }
}

export async function buildOpenRouterProvider(params: { apiKey?: string }) {
  const models = await discoverOpenRouterModels(params);
  return {
    baseUrl: OPENROUTER_BASE_URL,
    api: "openai-completions" as const,
    apiKey: params.apiKey,
    models,
  };
}
