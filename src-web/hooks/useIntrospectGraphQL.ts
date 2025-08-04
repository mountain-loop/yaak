import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import type { GraphQlIntrospection, HttpRequest } from '@yaakapp-internal/models';
import type { GraphQLSchema } from 'graphql';
import { buildClientSchema, getIntrospectionQuery } from 'graphql';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { minPromiseMillis } from '../lib/minPromiseMillis';
import { getResponseBodyText } from '../lib/responseBody';
import { sendEphemeralRequest } from '../lib/sendEphemeralRequest';
import { useActiveEnvironment } from './useActiveEnvironment';
import { useDebouncedValue } from './useDebouncedValue';

const introspectionRequestBody = JSON.stringify({
  query: getIntrospectionQuery(),
  operationName: 'IntrospectionQuery',
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
      const v = await invoke<GraphQlIntrospection>(
        'plugin:yaak-models|upsert_graphql_introspection',
        {
          requestId: baseRequest.id,
          workspaceId: baseRequest.workspaceId,
          content: content ?? '',
        },
      );

      // Update local introspection
      queryClient.setQueryData(['introspection', baseRequest.id], v);
    },
    [baseRequest.id, baseRequest.workspaceId, queryClient],
  );

  const refetch = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(undefined);

      const args = {
        ...baseRequest,
        bodyType: 'application/json',
        body: { text: introspectionRequestBody },
      };
      const response = await minPromiseMillis(
        sendEphemeralRequest(args, activeEnvironment?.id ?? null),
        700,
      );

      if (response.error) {
        return setError(response.error);
      }

      const bodyText = await getResponseBodyText(response);
      if (response.status < 200 || response.status >= 300) {
        return setError(
          `Request failed with status ${response.status}.\nThe response text is:\n\n${bodyText}`,
        );
      }

      if (bodyText === null) {
        return setError('Empty body returned in response');
      }

      console.log(`Got introspection response for ${baseRequest.url}`, bodyText);
      await upsertIntrospection(bodyText);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, [activeEnvironment?.id, baseRequest, upsertIntrospection]);

  useEffect(() => {
    // Skip introspection if automatic is disabled and we already have one
    if (options.disabled) {
      return;
    }

    refetch().catch(console.error);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseRequest.id, debouncedRequest.url, debouncedRequest.method, activeEnvironment?.id]);

  const clear = useCallback(async () => {
    setError('');
    setSchema(null);
    await upsertIntrospection(null);
  }, [upsertIntrospection]);

  useEffect(() => {
    if (introspection.data?.content == null || introspection.data.content === '') {
      return;
    }

    const parseResult = tryParseIntrospectionToSchema(introspection.data.content);
    if ('error' in parseResult) {
      setError(parseResult.error);
    } else {
      setSchema(parseResult.schema);
    }
  }, [introspection.data?.content]);

  return { schema, isLoading, error, refetch, clear };
}

function useIntrospectionResult(request: HttpRequest) {
  return useQuery({
    queryKey: ['introspection', request.id],
    queryFn: async () =>
      invoke<GraphQlIntrospection | null>('plugin:yaak-models|get_graphql_introspection', {
        requestId: request.id,
      }),
  });
}

export function useCurrentGraphQLSchema(request: HttpRequest) {
  const result = useIntrospectionResult(request);
  return useMemo(() => {
    if (result.data == null) return null;
    if (result.data.content == null || result.data.content === '') return null;
    const r = tryParseIntrospectionToSchema(result.data.content);
    return 'error' in r ? null : r.schema;
  }, [result.data]);
}

function tryParseIntrospectionToSchema(
  content: string,
): { schema: GraphQLSchema } | { error: string } {
  let parsedResponse;
  try {
    parsedResponse = JSON.parse(content).data;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    return { error: String('message' in e ? e.message : e) };
  }

  try {
    return { schema: buildClientSchema(parsedResponse, {}) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    return { error: String('message' in e ? e.message : e) };
  }
}
