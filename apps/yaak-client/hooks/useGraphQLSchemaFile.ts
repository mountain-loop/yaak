import { useKeyValue } from "./useKeyValue";

// The file a request's GraphQL schema is loaded from, or null when the schema
// comes from an introspection request.
//
// This is the *source*, not the schema. The introspection row it produces is a
// cache that expires on its own; this outlives it and regenerates it, the same
// way gRPC keeps its proto file list separate from a reflection result.
export function graphqlSchemaFileArgs(requestId: string | null) {
  return {
    namespace: "global" as const,
    key: ["graphql_schema_file", requestId ?? "n/a"],
  };
}

export function useGraphQLSchemaFile(requestId: string | null) {
  return useKeyValue<string | null>({ ...graphqlSchemaFileArgs(requestId), fallback: null });
}
