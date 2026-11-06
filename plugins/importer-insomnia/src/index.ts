import type { Context, ImportSource, PluginDefinition } from "@yaakapp/api";
import YAML from "yaml";
import { deleteUndefinedAttrs, isJSObject } from "./common";
import { convertInsomniaV4 } from "./v4";
import { convertInsomniaV5 } from "./v5";

export const plugin: PluginDefinition = {
  importer: {
    name: "Insomnia",
    description: "Import Insomnia workspaces",
    async onImportSource(_ctx: Context, { source }: { source: ImportSource }) {
      if (source.type !== "text") return null;
      return convertInsomnia(source.text);
    },
  },
};

export function convertInsomnia(contents: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(contents);
  } catch {
    // Fall through
  }

  try {
    parsed = parsed ?? YAML.parse(contents);
  } catch {
    // Fall through
  }

  if (!isJSObject(parsed)) return null;

  const result = convertInsomniaV5(parsed) ?? convertInsomniaV4(parsed);

  return deleteUndefinedAttrs(result);
}
