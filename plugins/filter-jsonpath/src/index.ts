import type { PluginDefinition } from "@yaakapp/api";
import { JSONPath } from "jsonpath-plus";

export const plugin: PluginDefinition = {
  filter: {
    name: "JSONPath",
    description: "Filter JSONPath",
    onFilter(_ctx, args) {
      const parsed = JSON.parse(args.payload);
      try {
        const filtered = JSONPath({ path: args.filter, json: parsed });
        return { content: JSON.stringify(filtered, null, 2) };
      } catch (err) {
        return {
          content: "",
          error: `Invalid filter: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  },
};
