import { useModelList } from '@yaakapp-internal/models';
import { showAlert } from '../lib/alert';
import { showConfirmDelete } from '../lib/confirm';
import { jotaiStore } from '../lib/jotai';
import { pluralizeCount } from '../lib/pluralize';
import { invokeCmd } from '../lib/tauri';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';
import { useFastMutation } from './useFastMutation';

export function useDeleteSendHistory() {
  const httpResponses = useModelList('http_response');
  const grpcConnections = useModelList('grpc_connection');
  const websocketConnections = useModelList('websocket_connection');
  const labels = [
    httpResponses.length > 0 ? pluralizeCount('Http Response', httpResponses.length) : null,
    grpcConnections.length > 0 ? pluralizeCount('Grpc Connection', grpcConnections.length) : null,
    websocketConnections.length > 0
      ? pluralizeCount('WebSocket Connection', websocketConnections.length)
      : null,
  ].filter((l) => l != null);

  return useFastMutation({
    mutationKey: ['delete_send_history', labels],
    mutationFn: async () => {
      if (labels.length === 0) {
        showAlert({
          id: 'no-responses',
          title: 'Nothing to Delete',
          body: 'There is no Http, Grpc, or Websocket history',
        });
        return;
      }

      const confirmed = await showConfirmDelete({
        id: 'delete-send-history',
        title: 'Clear Send History',
        description: <>Delete {labels.join(' and ')}?</>,
      });
      if (!confirmed) return false;

      const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
      await invokeCmd('cmd_delete_send_history', { workspaceId });
      return true;
    },
  });
}
