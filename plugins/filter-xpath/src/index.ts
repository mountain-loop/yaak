/* oxlint-disable no-base-to-string */
import { DOMParser } from "@xmldom/xmldom";
import type { PluginDefinition } from "@yaakapp/api";
import xpath from "xpath";

export const plugin: PluginDefinition = {
  filter: {
    name: "XPath",
    description: "Filter XPath",
    onFilter(_ctx, args) {
      // oxlint-disable-next-line no-explicit-any
      const doc: any = new DOMParser().parseFromString(args.payload, "text/xml");
      try {
        const result = xpath.select(args.filter, doc, false);
        if (Array.isArray(result)) {
          return { content: result.map((r) => String(r)).join("\n") };
        }
        // Not sure what cases this happens in (?)
        return { content: String(result) };
      } catch (err) {
        return {
          content: "",
          error: `Invalid filter: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  },
};
