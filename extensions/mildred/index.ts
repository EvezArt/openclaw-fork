import type { OpenClawPluginApi } from "../../src/plugins/types.js";

import { createMildredTool } from "./src/mildred-tool.js";

export default function register(api: OpenClawPluginApi) {
  api.registerTool(createMildredTool(api), { optional: true });
}
