import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { PluginDefinition } from "@yaakapp/api";

type PluginFeatureKey = Exclude<
  Extract<keyof PluginDefinition, string>,
  "init" | "dispose"
>;
type PluginAPIKey = PluginFeatureKey | "lifecycle";

type MetadataDefinition = {
  key: PluginFeatureKey;
  label: string;
  array: boolean;
};

type MetadataItem =
  | string
  | number
  | boolean
  | null
  | MetadataItem[]
  | { [key: string]: MetadataItem };

type APITypeMetadata = {
  label: string;
  source: string;
  count: number;
  items: MetadataItem[];
};

type PluginMetadata = {
  schemaVersion: 1;
  apiTypes: PluginAPIKey[];
  apis: Partial<Record<PluginAPIKey, APITypeMetadata>>;
};

const definitions: MetadataDefinition[] = [
  {
    key: "authentication",
    label: "Authentication",
    array: false,
  },
  { key: "filter", label: "Filter", array: false },
  {
    key: "folderActions",
    label: "Folder Action",
    array: true,
  },
  {
    key: "grpcRequestActions",
    label: "gRPC Request Action",
    array: true,
  },
  {
    key: "httpRequestActions",
    label: "HTTP Request Action",
    array: true,
  },
  { key: "importer", label: "Importer", array: false },
  {
    key: "templateFunctions",
    label: "Template Tag",
    array: true,
  },
  { key: "themes", label: "Theme", array: true },
  {
    key: "websocketRequestActions",
    label: "WebSocket Request Action",
    array: true,
  },
  {
    key: "workspaceActions",
    label: "Workspace Action",
    array: true,
  },
];

export function generatePluginMetadata(
  plugin: PluginDefinition,
): PluginMetadata {
  const metadata: PluginMetadata = {
    schemaVersion: 1,
    apiTypes: [],
    apis: {},
  };

  for (const definition of definitions) {
    const value = plugin[definition.key];
    const items = definition.array ? value : value ? [value] : [];

    if (!Array.isArray(items) || items.length === 0) {
      continue;
    }

    metadata.apiTypes.push(definition.key);
    metadata.apis[definition.key] = {
      label: definition.label,
      source: definition.key,
      count: items.length,
      items: sanitize(items) as MetadataItem[],
    };
  }

  const lifecycleHooks = ["init", "dispose"].filter(
    (key) =>
      typeof plugin[key as keyof Pick<PluginDefinition, "init" | "dispose">] ===
      "function",
  );
  if (lifecycleHooks.length > 0) {
    metadata.apiTypes.push("lifecycle");
    metadata.apis.lifecycle = {
      label: "Lifecycle Hook",
      source: lifecycleHooks.join(","),
      count: lifecycleHooks.length,
      items: lifecycleHooks.map((name) => ({ name })),
    };
  }

  return metadata;
}

const entryPath = process.argv[1];
const outputPath = process.argv[2];

if (!entryPath) {
  throw new Error("Missing plugin entrypoint path");
}
if (!outputPath) {
  throw new Error("Missing plugin metadata output path");
}

const require = createRequire(path.join(process.cwd(), "plugin-metadata.js"));
const moduleExports = require(path.resolve(entryPath)) as PluginDefinition & {
  plugin?: PluginDefinition;
  default?: PluginDefinition;
};
const plugin = moduleExports.plugin ?? moduleExports.default ?? moduleExports;

if (!plugin || typeof plugin !== "object") {
  throw new Error("Plugin entrypoint must export a plugin object");
}

const metadata = generatePluginMetadata(plugin);
fs.writeFileSync(outputPath, `${JSON.stringify(metadata, null, 2)}\n`);

function sanitize(
  value: unknown,
  seen = new WeakSet<object>(),
): MetadataItem | undefined {
  if (value === null) return null;

  switch (typeof value) {
    case "boolean":
    case "number":
    case "string":
      return value;
    case "bigint":
      return value.toString();
    case "function":
    case "symbol":
    case "undefined":
      return undefined;
  }

  const objectValue = value as object;
  if (seen.has(objectValue)) {
    return "[Circular]";
  }

  seen.add(objectValue);

  if (Array.isArray(value)) {
    const output = value.map((item) => sanitize(item, seen) ?? null);
    seen.delete(objectValue);
    return output;
  }

  const output: Record<string, MetadataItem> = {};
  for (const [key, item] of Object.entries(objectValue)) {
    const sanitized = sanitize(item, seen);
    if (sanitized !== undefined) {
      output[key] = sanitized;
    }
  }

  seen.delete(objectValue);
  return output;
}
