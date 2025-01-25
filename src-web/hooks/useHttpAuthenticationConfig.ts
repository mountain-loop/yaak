import { useQuery } from '@tanstack/react-query';
import type { GetHttpAuthenticationConfigResponse, JsonPrimitive } from '@yaakapp-internal/plugins';
import { md5 } from 'js-md5';
import { invokeCmd } from '../lib/tauri';
import { useHttpResponses } from './useHttpResponses';

export function useHttpAuthenticationConfig(
  authName: string | null,
  config: Record<string, JsonPrimitive>,
  requestId: string,
) {
  const responses = useHttpResponses();

  // Some auth handlers like OAuth 2.0 show the current token after a successful request. To
  // handle that, we'll force the auth to re-fetch after each new response closes
  const responseKey = md5(
    responses
      .filter((r) => r.state === 'closed')
      .map((r) => r.id)
      .join(':'),
  );

  return useQuery({
    queryKey: ['http_authentication_config', requestId, authName, config, responseKey],
    placeholderData: (prev) => prev, // Keep previous data on refetch
    queryFn: async () => {
      return invokeCmd<GetHttpAuthenticationConfigResponse>('cmd_get_http_authentication_config', {
        authName,
        config,
        requestId,
      });
    },
  });
}
