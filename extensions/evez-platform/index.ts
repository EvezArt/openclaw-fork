import type { OpenClawPluginApi } from "../../src/plugins/types.js";

import { createEvezResearchTool, createEvezJourneyTool } from "./src/evez-platform-tools.js";
import { createEvezModelLabTool } from "./src/evez-model-lab.js";

export default function register(api: OpenClawPluginApi) {
  api.registerTool(createEvezResearchTool(api), { optional: true });
  api.registerTool(createEvezJourneyTool(api), { optional: true });
  api.registerTool(createEvezModelLabTool(api), { optional: true });
}
