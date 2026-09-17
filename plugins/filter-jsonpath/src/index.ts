import type { PluginDefinition } from "@yaakapp/api";
import { jsonPathToSegments } from "@yaakapp-internal/lib/jsonPath";
import { JSONPath } from "jsonpath-plus";

export const plugin: PluginDefinition = {
  filter: {
    name: "JSONPath",
    description: "Filter JSONPath",
    onFilter(_ctx, args) {
      const parsed = JSON.parse(args.payload);
      try {
        // jsonpath-plus doesn't decode JSON-quoted keys reliably and can treat
        // their contents as operators. Only complete literal paths take this
        // route; all other expressions retain the library's existing behavior.
        const segments = args.filter.includes('["') ? jsonPathToSegments(args.filter) : null;
        let filtered: unknown;
        if (segments != null) {
          let value: unknown = parsed;
          for (const segment of segments) {
            const key = segment.kind === "key" ? segment.key : segment.index;
            if (value == null || !Object.prototype.hasOwnProperty.call(value, key)) {
              return { content: "[]" };
            }
            value = (value as Record<string, unknown>)[key];
          }
          filtered = [value];
        } else {
          filtered = JSONPath({ path: args.filter, json: parsed });
        }
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
