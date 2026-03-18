import {
  grpcConnectionsAtom,
  httpResponsesAtom,
  websocketConnectionsAtom,
} from "@yaakapp-internal/models";
import { useAtomValue } from "jotai";
import { showAlert } from "../lib/alert";
import { showConfirmDelete } from "../lib/confirm";
import { jotaiStore } from "../lib/jotai";
import { pluralizeCount } from "../lib/pluralize";
import { invokeCmd } from "../lib/tauri";
import { activeWorkspaceIdAtom } from "./useActiveWorkspace";
import { useFastMutation } from "./useFastMutation";

export function useDeleteSendHistory() {
  const httpResponses = useAtomValue(httpResponsesAtom);
  const grpcConnections = useAtomValue(grpcConnectionsAtom);
  const websocketConnections = useAtomValue(websocketConnectionsAtom);

  const labels = [
    httpResponses.length > 0 ? pluralizeCount("HTTP-ответ", httpResponses.length) : null,
    grpcConnections.length > 0 ? pluralizeCount("gRPC-соединение", grpcConnections.length) : null,
    websocketConnections.length > 0
      ? pluralizeCount("WebSocket-соединение", websocketConnections.length)
      : null,
  ].filter((l) => l != null);

  return useFastMutation({
    mutationKey: ["delete_send_history", labels],
    mutationFn: async () => {
      if (labels.length === 0) {
        showAlert({
          id: "no-responses",
          title: "Нечего удалять",
          body: "История HTTP, gRPC и WebSocket пуста",
        });
        return;
      }

      const confirmed = await showConfirmDelete({
        id: "delete-send-history",
        title: "Очистить историю отправок",
        description: <>Удалить {labels.join(" и ")}?</>,
      });
      if (!confirmed) return false;

      const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
      await invokeCmd("cmd_delete_send_history", { workspaceId });
      return true;
    },
  });
}
