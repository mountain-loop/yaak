import { useSetAtom } from 'jotai/index';
import { showAlert } from '../lib/alert';
import { showConfirm } from '../lib/confirm';
import { pluralizeCount } from '../lib/pluralize';
import { invokeCmd } from '../lib/tauri';
import { getActiveWorkspaceId } from './useActiveWorkspace';
import { useFastMutation } from './useFastMutation';
import { useGrpcConnections } from './useGrpcConnections';
import { httpResponsesAtom, useHttpResponses } from './useHttpResponses';

export function useDeleteSendHistory() {
  const setHttpResponses = useSetAtom(httpResponsesAtom);
  const httpResponses = useHttpResponses();
  const grpcConnections = useGrpcConnections();
  const labels = [
    httpResponses.length > 0 ? pluralizeCount('Http Response', httpResponses.length) : null,
    grpcConnections.length > 0 ? pluralizeCount('Grpc Connection', grpcConnections.length) : null,
  ].filter((l) => l != null);

  return useFastMutation({
    mutationKey: ['delete_send_history'],
    mutationFn: async () => {
      if (labels.length === 0) {
        showAlert({
          id: 'no-responses',
          title: 'Nothing to Delete',
          body: 'There are no Http Response or Grpc Connections to delete',
        });
        return;
      }

      const confirmed = await showConfirm({
        id: 'delete-send-history',
        title: 'Clear Send History',
        variant: 'delete',
        description: <>Delete {labels.join(' and ')}?</>,
      });
      if (!confirmed) return false;

      const workspaceId = getActiveWorkspaceId();
      await invokeCmd('cmd_delete_send_history', { workspaceId });
      return true;
    },
    onSuccess: async (confirmed) => {
      if (!confirmed) return;
      const activeWorkspaceId = getActiveWorkspaceId();
      setHttpResponses((all) => all.filter((r) => r.workspaceId !== activeWorkspaceId));
    },
  });
}
