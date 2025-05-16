import { useQuery } from '@tanstack/react-query';
import type { GrpcRequest, HttpRequest, WebsocketRequest } from '@yaakapp-internal/models';
import { httpResponsesAtom } from '@yaakapp-internal/models';
import type { GetHttpAuthenticationConfigResponse, JsonPrimitive } from '@yaakapp-internal/plugins';
import { useAtomValue } from 'jotai';
import { md5 } from 'js-md5';
import { useState } from 'react';
import { invokeCmd } from '../lib/tauri';

export function useHttpAuthenticationConfig(
  authName: string | null,
  values: Record<string, JsonPrimitive>,
  requestId: string,
) {
  const responses = useAtomValue(httpResponsesAtom);
  const [forceRefreshCounter, setForceRefreshCounter] = useState<number>(0);

  // Some auth handlers like OAuth 2.0 show the current token after a successful request. To
  // handle that, we'll force the auth to re-fetch after each new response closes
  const responseKey = md5(
    responses
      .filter((r) => r.state === 'closed')
      .map((r) => r.id)
      .join(':'),
  );

  return useQuery({
    queryKey: [
      'http_authentication_config',
      requestId,
      authName,
      values,
      responseKey,
      forceRefreshCounter,
    ],
    placeholderData: (prev) => prev, // Keep previous data on refetch
    queryFn: async () => {
      if (authName == null) return null;
      const config = await invokeCmd<GetHttpAuthenticationConfigResponse>(
        'cmd_get_http_authentication_config',
        {
          authName,
          values,
          requestId,
        },
      );

      return {
        ...config,
        actions: config.actions?.map((a, i) => ({
          ...a,
          call: async ({ id: requestId }: HttpRequest | GrpcRequest | WebsocketRequest) => {
            await invokeCmd('cmd_call_http_authentication_action', {
              pluginRefId: config.pluginRefId,
              actionIndex: i,
              authName,
              values,
              requestId,
            });

            // Ensure the config is refreshed after the action is done
            setForceRefreshCounter((c) => c + 1);
          },
        })),
      };
    },
  });
}
