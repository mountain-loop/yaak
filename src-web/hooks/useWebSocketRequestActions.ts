import { useQuery } from '@tanstack/react-query';
import type { WebsocketRequest } from '@yaakapp-internal/models';
import type {
  CallWebSocketRequestActionRequest,
  GetWebSocketRequestActionsResponse,
  WebSocketRequestAction,
} from '@yaakapp-internal/plugins';
import { useMemo } from 'react';
import { invokeCmd } from '../lib/tauri';
import { usePluginsKey } from './usePlugins';

export type CallableWebSocketRequestAction = Pick<WebSocketRequestAction, 'label' | 'icon'> & {
  call: (request: WebsocketRequest) => Promise<void>;
};

export function useWebSocketRequestActions() {
  const pluginsKey = usePluginsKey();

  const actionsResult = useQuery<CallableWebSocketRequestAction[]>({
    queryKey: ['websocket_request_actions', pluginsKey],
    queryFn: () => getWebSocketRequestActions(),
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: none
  const actions = useMemo(() => {
    return actionsResult.data ?? [];
  }, [JSON.stringify(actionsResult.data)]);

  return actions;
}

export async function getWebSocketRequestActions() {
  const responses = await invokeCmd<GetWebSocketRequestActionsResponse[]>(
    'cmd_websocket_request_actions',
  );
  const actions = responses.flatMap((r) =>
    r.actions.map((a, i) => ({
      label: a.label,
      icon: a.icon,
      call: async (websocketRequest: WebsocketRequest) => {
        const payload: CallWebSocketRequestActionRequest = {
          index: i,
          pluginRefId: r.pluginRefId,
          args: { websocketRequest },
        };
        await invokeCmd('cmd_call_websocket_request_action', { req: payload });
      },
    })),
  );

  return actions;
}
