/**
 * Subset of JSON Schema emitted by the gRPC reflection layer for a method's
 * input message. See `message_to_json_schema` in the `yaak-grpc` crate.
 */
export type JsonSchema = {
  type?: string;
  format?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  additionalProperties?: JsonSchema;
  enum?: unknown[];
  $defs?: Record<string, JsonSchema>;
  $ref?: string;
};

const DEFS_PREFIX = "#/$defs/";
const ROOT_REF = "#";

// Protobuf 64-bit integers are encoded as strings in the JSON mapping
const STRING_NUMBER_FORMATS = ["int64", "uint64", "sint64", "fixed64", "sfixed64"];

/** Build a sample message with placeholder values for every field in the schema */
export function buildExampleFromSchema(schema: JsonSchema): unknown {
  // The root is already being built, so a `#` ref anywhere below it is a cycle
  return buildValue(schema, schema, new Set([ROOT_REF]));
}

function buildValue(schema: JsonSchema, root: JsonSchema, refPath: Set<string>): unknown {
  if (schema == null || typeof schema !== "object") {
    return null;
  }

  if (typeof schema.$ref === "string") {
    if (refPath.has(schema.$ref)) {
      return {};
    }
    const resolved = resolveRef(schema.$ref, root);
    if (resolved == null) {
      return {};
    }
    return buildValue(resolved, root, new Set(refPath).add(schema.$ref));
  }

  if (Array.isArray(schema.enum)) {
    return schema.enum[0] ?? "";
  }

  switch (schema.type) {
    case "object":
      return buildObject(schema, root, refPath);
    case "array":
      return schema.items == null ? [] : [buildValue(schema.items, root, refPath)];
    case "string":
      return buildString(schema.format);
    case "number":
      return 0;
    case "boolean":
      return false;
    default:
      return null;
  }
}

function buildObject(schema: JsonSchema, root: JsonSchema, refPath: Set<string>): unknown {
  if (schema.properties != null && typeof schema.properties === "object") {
    const example: Record<string, unknown> = {};
    for (const [name, propertySchema] of Object.entries(schema.properties)) {
      example[name] = buildValue(propertySchema, root, refPath);
    }
    return example;
  }

  // Maps have no properties, only a value schema
  if (schema.additionalProperties != null) {
    return { key: buildValue(schema.additionalProperties, root, refPath) };
  }

  return {};
}

function buildString(format: string | undefined): string {
  if (format === "date-time") {
    return new Date().toISOString();
  }
  if (format != null && STRING_NUMBER_FORMATS.includes(format)) {
    return "0";
  }
  return "";
}

function resolveRef(ref: string, root: JsonSchema): JsonSchema | null {
  if (ref === ROOT_REF) {
    return root;
  }
  if (!ref.startsWith(DEFS_PREFIX)) {
    return null;
  }
  return root.$defs?.[ref.slice(DEFS_PREFIX.length)] ?? null;
}
