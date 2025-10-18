import { useQuery } from '@tanstack/react-query';
import type { HttpRequest } from '@yaakapp-internal/models';
import type {
  CallHttpRequestActionRequest,
  GetHttpRequestActionsResponse,
  HttpRequestAction,
} from '@yaakapp-internal/plugins';
import { useMemo } from 'react';
import { invokeCmd } from '../lib/tauri';
import { usePluginsKey } from './usePlugins';

export type CallableHttpRequestAction = Pick<HttpRequestAction, 'label' | 'icon'> & {
  call: (httpRequest: HttpRequest) => Promise<void>;
};

export function useHttpRequestActions() {
  const pluginsKey = usePluginsKey();

  const actionsResult = useQuery<CallableHttpRequestAction[]>({
    queryKey: ['http_request_actions', pluginsKey],
    queryFn: () => getHttpRequestActions(),
  });

  const actions = useMemo(() => {
    return actionsResult.data ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(actionsResult.data)]);

  return actions;
}

export async function getHttpRequestActions() {
  const responses = await invokeCmd<GetHttpRequestActionsResponse[]>('cmd_http_request_actions');
  const actions = responses.flatMap((r) =>
    r.actions.map((a, i) => ({
      label: a.label,
      icon: a.icon,
      call: async (httpRequest: HttpRequest) => {
        const payload: CallHttpRequestActionRequest = {
          index: i,
          pluginRefId: r.pluginRefId,
          args: { httpRequest },
        };
        await invokeCmd('cmd_call_http_request_action', { req: payload });
      },
    })),
  );

  return actions;
}
