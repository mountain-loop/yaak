import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { GraphQlIntrospection, HttpRequest } from "@yaakapp-internal/models";
import { platform } from "@yaakapp-internal/platform";
import type { GraphQLSchema, IntrospectionQuery } from "graphql";
import { buildClientSchema, getIntrospectionQuery } from "graphql";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tryBuildIntrospectionFromFile } from "../lib/graphqlSchema";
import { minPromiseMillis } from "../lib/minPromiseMillis";
import { sendEphemeralRequest } from "../lib/sendEphemeralRequest";
import { useActiveEnvironment } from "./useActiveEnvironment";
import { useGraphQLSchemaFile } from "./useGraphQLSchemaFile";
import { useDebouncedValue } from "@yaakapp-internal/ui";
import { rpc } from "../lib/rpc";

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

  // The schema's source. Outlives the introspection row it produces, so a
  // request configured with a file keeps working after the row is swept.
  const schemaFile = useGraphQLSchemaFile(baseRequest.id);
  const filePath = schemaFile.value ?? null;

  const upsertIntrospection = useCallback(
    async (content: string | null) => {
      const v = await rpc<GraphQlIntrospection>("models_upsert_graphql_introspection", {
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
      const { response, body } = await minPromiseMillis(
        sendEphemeralRequest(args, activeEnvironment?.id ?? null),
        700,
      );

      if (response.error) {
        return setError(response.error);
      }

      // The send hands back the only copy of the body — an unsaved response has
      // nothing on disk and no row to read it back from
      const bodyText = new TextDecoder("utf-8").decode(new Uint8Array(body));
      if (response.status < 200 || response.status >= 300) {
        return setError(
          `Request failed with status ${response.status}.\nThe response text is:\n\n${bodyText}`,
        );
      }

      if (bodyText === "") {
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

    // A request pointed at a file gets its schema from that file. Introspecting
    // here would overwrite it on the next URL edit.
    if (filePath != null) {
      return;
    }

    refetch().catch(console.error);
  }, [
    baseRequest.id,
    debouncedRequest.url,
    debouncedRequest.method,
    activeEnvironment?.id,
    filePath,
  ]);

  // Clears the schema, not the source. Removing a file source is a separate
  // action, because the source is what would rebuild this a moment later.
  const clear = useCallback(async () => {
    setError("");
    setSchema(null);
    await upsertIntrospection(null);
  }, [upsertIntrospection]);

  // Reads a schema file and produces an introspection row from it, the same way
  // `refetch` produces one from a server. Does not touch the stored source.
  const introspectFromFile = useCallback(
    async (path: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        setIsLoading(true);
        setError(undefined);

        const fileContent = await platform.files.readText(path);
        const result = tryBuildIntrospectionFromFile(fileContent);

        if ("error" in result) {
          setError(result.error);
          return { ok: false, error: result.error };
        }

        await upsertIntrospection(result.content);
        return { ok: true };
      } catch (err) {
        // The host rejects with a bare string for a missing or unreadable path,
        // so this can't assume an Error.
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        return { ok: false, error: message };
      } finally {
        setIsLoading(false);
      }
    },
    [upsertIntrospection],
  );

  // Points the request at a file and immediately builds its schema from it.
  const loadFromFile = useCallback(
    async (path: string) => {
      const result = await introspectFromFile(path);
      if (result.ok) await schemaFile.set(path);
      return result;
    },
    [introspectFromFile, schemaFile],
  );

  const reloadFromFile = useCallback(async () => {
    if (filePath == null) return { ok: false as const, error: "No schema file to reload" };
    return introspectFromFile(filePath);
  }, [filePath, introspectFromFile]);

  // The file-source counterpart of automatic introspection: re-read the file
  // when the request is opened, so an edited schema is picked up without asking.
  //
  // A missing row is repaired even with the setting off — that is recovering
  // from the 7-day sweep, not keeping the schema fresh, and skipping it would
  // make the schema disappear with no visible cause.
  const reloadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (filePath == null || introspection.isLoading) return;
    // Only attempt once per path, so an unreadable file doesn't spin.
    if (reloadedFor.current === filePath) return;

    const hasContent = (introspection.data?.content ?? "") !== "";
    if (hasContent && options.disabled) return;

    reloadedFor.current = filePath;
    introspectFromFile(filePath).catch(console.error);
  }, [
    filePath,
    introspection.data?.content,
    introspection.isLoading,
    introspectFromFile,
    options.disabled,
  ]);

  // Stops using the file. The schema goes with it, since the file is what
  // produced it; introspection repopulates if it's set to run automatically.
  const removeSchemaFile = useCallback(async () => {
    setError("");
    setSchema(null);
    await schemaFile.set(null);
    await upsertIntrospection(null);
  }, [schemaFile, upsertIntrospection]);

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

  return {
    schema,
    isLoading,
    error,
    refetch,
    clear,
    loadFromFile,
    reloadFromFile,
    removeSchemaFile,
    filePath,
  };
}

function useIntrospectionResult(request: HttpRequest) {
  return useQuery({
    queryKey: ["introspection", request.id],
    queryFn: async () =>
      rpc<GraphQlIntrospection | null>("models_get_graphql_introspection", {
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
