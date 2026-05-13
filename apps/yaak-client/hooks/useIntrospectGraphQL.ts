import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import type { GraphQlIntrospection, HttpRequest } from "@yaakapp-internal/models";
import type { GraphQLSchema, IntrospectionQuery } from "graphql";
import {
  buildClientSchema,
  buildSchema,
  getIntrospectionQuery,
  introspectionFromSchema,
} from "graphql";
import { useCallback, useEffect, useMemo, useState } from "react";
import { minPromiseMillis } from "../lib/minPromiseMillis";
import { getResponseBodyText } from "../lib/responseBody";
import { sendEphemeralRequest } from "../lib/sendEphemeralRequest";
import { useActiveEnvironment } from "./useActiveEnvironment";
import { useDebouncedValue } from "@yaakapp-internal/ui";

const introspectionRequestBody = JSON.stringify({
  query: getIntrospectionQuery(),
  operationName: "IntrospectionQuery",
});

export function useIntrospectGraphQL(
  baseRequest: HttpRequest,
  options: { disabled?: boolean } = {},
) {
  // Debounce the request because it can change rapidly, and we don't
  // want to send so too many requests.
  const debouncedRequest = useDebouncedValue(baseRequest);
  const activeEnvironment = useActiveEnvironment();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>();
  const [schema, setSchema] = useState<GraphQLSchema | null>(null);
  const queryClient = useQueryClient();

  const introspection = useIntrospectionResult(baseRequest);

  const upsertIntrospection = useCallback(
    async (content: string | null) => {
      const v = await invoke<GraphQlIntrospection>("models_upsert_graphql_introspection", {
        requestId: baseRequest.id,
        workspaceId: baseRequest.workspaceId,
        content: content ?? "",
      });

      // Update local introspection
      queryClient.setQueryData(["introspection", baseRequest.id], v);
    },
    [baseRequest.id, baseRequest.workspaceId, queryClient],
  );

  const refetch = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(undefined);

      const args = {
        ...baseRequest,
        bodyType: "application/json",
        body: { text: introspectionRequestBody },
      };
      const response = await minPromiseMillis(
        sendEphemeralRequest(args, activeEnvironment?.id ?? null),
        700,
      );

      if (response.error) {
        return setError(response.error);
      }

      const bodyText = await getResponseBodyText({ response, filter: null });
      if (response.status < 200 || response.status >= 300) {
        return setError(
          `Request failed with status ${response.status}.\nThe response text is:\n\n${bodyText}`,
        );
      }

      if (bodyText === null) {
        return setError("Empty body returned in response");
      }

      console.log(`Got introspection response for ${baseRequest.url}`, bodyText);
      await upsertIntrospection(bodyText);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, [activeEnvironment?.id, baseRequest, upsertIntrospection]);

  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Skip introspection if automatic is disabled and we already have one
    if (options.disabled) {
      return;
    }

    refetch().catch(console.error);
  }, [baseRequest.id, debouncedRequest.url, debouncedRequest.method, activeEnvironment?.id]);

  const clear = useCallback(async () => {
    setError("");
    setSchema(null);
    await upsertIntrospection(null);
  }, [upsertIntrospection]);

  const loadFromFile = useCallback(
    async (path: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        setIsLoading(true);
        setError(undefined);

        const bytes = await readFile(path);
        const fileContent = new TextDecoder().decode(bytes);
        const result = tryBuildIntrospectionFromFile(fileContent);

        if ("error" in result) {
          setError(result.error);
          return { ok: false, error: result.error };
        }

        await upsertIntrospection(result.content);
        return { ok: true };
        // oxlint-disable-next-line no-explicit-any
      } catch (err: any) {
        const message = String("message" in err ? err.message : err);
        setError(message);
        return { ok: false, error: message };
      } finally {
        setIsLoading(false);
      }
    },
    [upsertIntrospection],
  );

  useEffect(() => {
    if (introspection.data?.content == null || introspection.data.content === "") {
      return;
    }

    const parseResult = tryParseIntrospectionToSchema(introspection.data.content);
    if ("error" in parseResult) {
      setError(parseResult.error);
    } else {
      setSchema(parseResult.schema);
    }
  }, [introspection.data?.content]);

  return { schema, isLoading, error, refetch, clear, loadFromFile };
}

function useIntrospectionResult(request: HttpRequest) {
  return useQuery({
    queryKey: ["introspection", request.id],
    queryFn: async () =>
      invoke<GraphQlIntrospection | null>("models_get_graphql_introspection", {
        requestId: request.id,
      }),
  });
}

export function useCurrentGraphQLSchema(request: HttpRequest) {
  const result = useIntrospectionResult(request);
  return useMemo(() => {
    if (result.data == null) return null;
    if (result.data.content == null || result.data.content === "") return null;
    const r = tryParseIntrospectionToSchema(result.data.content);
    return "error" in r ? null : r.schema;
  }, [result.data]);
}

function tryParseIntrospectionToSchema(
  content: string,
): { schema: GraphQLSchema } | { error: string } {
  let parsedResponse: IntrospectionQuery;
  try {
    parsedResponse = JSON.parse(content).data;
    // oxlint-disable-next-line no-explicit-any
  } catch (e: any) {
    return { error: String("message" in e ? e.message : e) };
  }

  try {
    return { schema: buildClientSchema(parsedResponse, {}) };
    // oxlint-disable-next-line no-explicit-any
  } catch (e: any) {
    return { error: String("message" in e ? e.message : e) };
  }
}

// Accepts either a GraphQL introspection JSON ({ data: { __schema } } or
// { __schema }) or an SDL string and normalizes both into the wrapped
// { data: <introspection> } JSON shape that this hook persists.
function tryBuildIntrospectionFromFile(
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
