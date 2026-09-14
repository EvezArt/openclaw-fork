import type { OpenClawPluginApi } from "../../src/plugins/types.js";

import { createEvezResearchTool, createEvezJourneyTool } from "./src/evez-platform-tools.js";

export default function register(api: OpenClawPluginApi) {
  api.registerTool(createEvezResearchTool(api), { optional: true });
  api.registerTool(createEvezJourneyTool(api), { optional: true });
}
