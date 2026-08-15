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
        } catch (e) {
          return {
            error: `Failed to build schema from introspection JSON: ${errorMessage(e)}`,
          };
        }
      }
    }
  }

  try {
    const schema = buildSchema(fileContent);
    const introspection = introspectionFromSchema(schema);
    return { schema, content: JSON.stringify({ data: introspection }) };
  } catch (e) {
    return {
      error: `Could not parse file as introspection JSON or GraphQL SDL: ${errorMessage(e)}`,
    };
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
