import type { HttpRequest } from '@yaakapp-internal/models';
import { buildClientSchema, getIntrospectionQuery, type IntrospectionQuery } from 'graphql';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { minPromiseMillis } from '../lib/minPromiseMillis';
import { getResponseBodyText } from '../lib/responseBody';
import { sendEphemeralRequest } from '../lib/sendEphemeralRequest';
import { useActiveEnvironment } from './useActiveEnvironment';
import { useDebouncedValue } from './useDebouncedValue';
import { useKeyValue } from './useKeyValue';

const introspectionRequestBody = JSON.stringify({
  query: getIntrospectionQuery(),
  operationName: 'IntrospectionQuery',
});

export function useIntrospectGraphQL(
  baseRequest: HttpRequest,
  options: { disabled?: boolean } = {},
) {
  // Debounce the request because it can change rapidly and we don't
  // want to send so too many requests.
  const request = useDebouncedValue(baseRequest);
  const activeEnvironment = useActiveEnvironment();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>();

  const { value: introspection, set: setIntrospection } = useKeyValue<IntrospectionQuery | null>({
    key: ['graphql_introspection', baseRequest.id],
    fallback: null,
    namespace: 'global',
  });

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
        return setError(`Request failed with status ${response.status}.\nThe response body is:\n\n${bodyText}`);
      }

      if (bodyText === null) {
        return setError('Empty body returned in response');
      }

      const { data } = JSON.parse(bodyText);
      console.log(`Got introspection response for ${baseRequest.url}`, data);
      await setIntrospection(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, [activeEnvironment?.id, baseRequest, setIntrospection]);

  useEffect(() => {
    // Skip introspection if automatic is disabled and we already have one
    if (options.disabled) {
      return;
    }

    refetch().catch(console.error);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id, request.url, request.method, activeEnvironment?.id]);

  const clear = useCallback(async () => {
    setError('');
    await setIntrospection(null);
  }, [setIntrospection]);

  const schema = useMemo(() => {
    if (introspection == null) {
      return introspection;
    }
    try {
      return buildClientSchema(introspection);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError('message' in e ? e.message : String(e));
    }
  }, [introspection]);

  return { schema, isLoading, error, refetch, clear };
}
