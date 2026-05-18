import type { GraphQLSchema, IntrospectionQuery } from "graphql";
import { buildClientSchema, buildSchema, introspectionFromSchema } from "graphql";

// Accepts either a GraphQL introspection JSON ({ data: { __schema } } or
// { __schema }) or an SDL string and normalizes both into the wrapped
// { data: <introspection> } JSON shape used by the introspection store.
export function tryBuildIntrospectionFromFile(
  fileContent: string,
): { schema: GraphQLSchema; content: string } | { error: string } {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(fileContent);
  } catch {
    parsedJson = undefined;
  }

  if (parsedJson != null && typeof parsedJson === "object") {
    const candidates: unknown[] = [(parsedJson as { data?: unknown }).data, parsedJson];

    for (const candidate of candidates) {
      if (
        candidate != null &&
        typeof candidate === "object" &&
        "__schema" in (candidate as Record<string, unknown>)
      ) {
        try {
          const schema = buildClientSchema(candidate as IntrospectionQuery, {});
          return { schema, content: JSON.stringify({ data: candidate }) };
          // oxlint-disable-next-line no-explicit-any
        } catch (e: any) {
          return {
            error: `Failed to build schema from introspection JSON: ${String(
              "message" in e ? e.message : e,
            )}`,
          };
        }
      }
    }
  }

  try {
    const schema = buildSchema(fileContent);
    const introspection = introspectionFromSchema(schema);
    return { schema, content: JSON.stringify({ data: introspection }) };
    // oxlint-disable-next-line no-explicit-any
  } catch (e: any) {
    return {
      error: `Could not parse file as introspection JSON or GraphQL SDL: ${String(
        "message" in e ? e.message : e,
      )}`,
    };
  }
}
