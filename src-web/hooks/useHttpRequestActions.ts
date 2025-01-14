import { useQuery } from '@tanstack/react-query';
import type { HttpRequest } from '@yaakapp-internal/models';
import type {
  CallHttpRequestActionRequest,
  GetHttpRequestActionsResponse,
  HttpRequestAction,
} from '@yaakapp-internal/plugins';
import { invokeCmd } from '../lib/tauri';
import { usePluginsKey } from './usePlugins';
import { useMemo } from 'react';

export type CallableHttpRequestAction = Pick<HttpRequestAction, 'key' | 'label' | 'icon'> & {
  call: (httpRequest: HttpRequest) => Promise<void>;
};

export function useHttpRequestActions() {
  const pluginsKey = usePluginsKey();

  const actionsResult = useQuery<CallableHttpRequestAction[]>({
    queryKey: ['http_request_actions', pluginsKey],
    queryFn: async () => {
      const responses = await invokeCmd<GetHttpRequestActionsResponse[]>(
        'cmd_http_request_actions',
      );

      return responses.flatMap((r) =>
        r.actions.map((a) => ({
          key: a.key,
          label: a.label,
          icon: a.icon,
          call: async (httpRequest: HttpRequest) => {
            const payload: CallHttpRequestActionRequest = {
              key: a.key,
              pluginRefId: r.pluginRefId,
              args: { httpRequest },
            };
            await invokeCmd('cmd_call_http_request_action', { req: payload });
          },
        })),
      );
    },
  });

  const actions = useMemo(() => {
    return actionsResult.data ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(actionsResult.data)]);

  return actions;
}
