import { useQuery } from "@tanstack/react-query";
import type { WebsocketRequest } from "@yaakapp-internal/models";
import type {
  CallWebsocketRequestActionRequest,
  GetWebsocketRequestActionsResponse,
  WebsocketRequestAction,
} from "@yaakapp-internal/plugins";
import { useMemo } from "react";
import { rpc } from "../lib/rpc";
import { usePluginsKey } from "./usePlugins";

export type CallableWebSocketRequestAction = Pick<WebsocketRequestAction, "label" | "icon"> & {
  call: (request: WebsocketRequest) => Promise<void>;
};

export function useWebsocketRequestActions() {
  const pluginsKey = usePluginsKey();

  const actionsResult = useQuery<CallableWebSocketRequestAction[]>({
    queryKey: ["websocket_request_actions", pluginsKey],
    queryFn: () => getWebsocketRequestActions(),
  });

  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const actions = useMemo(() => {
    return actionsResult.data ?? [];
  }, [JSON.stringify(actionsResult.data)]);

  return actions;
}

export async function getWebsocketRequestActions() {
  const responses = await rpc<GetWebsocketRequestActionsResponse[]>(
    "cmd_websocket_request_actions",
  );
  const actions = responses.flatMap((r) =>
    r.actions.map((a: WebsocketRequestAction, i: number) => ({
      label: a.label,
      icon: a.icon,
      call: async (websocketRequest: WebsocketRequest) => {
        const payload: CallWebsocketRequestActionRequest = {
          index: i,
          pluginRefId: r.pluginRefId,
          args: { websocketRequest },
        };
        await rpc("cmd_call_websocket_request_action", { req: payload });
      },
    })),
  );

  return actions;
}
