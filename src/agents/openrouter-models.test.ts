import { describe, expect, it } from "vitest";
import { buildOpenRouterModelDefinition, discoverOpenRouterModels } from "./openrouter-models.js";

describe("OpenRouter model normalization", () => {
  it("maps pricing, context, and vision capabilities from the public catalog shape", () => {
    const model = buildOpenRouterModelDefinition({
      id: "acme/vision-model",
      name: "Vision Model",
      context_length: 65536,
      max_completion_tokens: 8192,
      pricing: { prompt: "0.000001", completion: "0.000003" },
      architecture: { input_modalities: ["text", "image"] },
      supported_parameters: ["reasoning"],
    });
    expect(model).toMatchObject({
      id: "acme/vision-model",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 65536,
      cost: { input: 1, output: 3 },
    });
  });

  it("discovers all returned models without assuming a vendor-specific id", async () => {
    const models = await discoverOpenRouterModels({
      fetchFn: async () =>
        new Response(JSON.stringify({ data: [{ id: "one" }, { id: "two:free" }] }), {
          status: 200,
        }),
    });
    expect(models.map((model) => model.id)).toEqual(["one", "two:free"]);
  });
});
