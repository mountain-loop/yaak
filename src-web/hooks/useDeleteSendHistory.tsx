import { useMutation } from '@tanstack/react-query';
import { useSetAtom } from 'jotai/index';
import { count } from '../lib/pluralize';
import { invokeCmd } from '../lib/tauri';
import { useActiveWorkspace } from './useActiveWorkspace';
import { useAlert } from './useAlert';
import { useConfirm } from './useConfirm';
import { useGrpcConnections } from './useGrpcConnections';
import { httpResponsesAtom, useHttpResponses } from './useHttpResponses';

export function useDeleteSendHistory() {
  const confirm = useConfirm();
  const alert = useAlert();
  const setHttpResponses = useSetAtom(httpResponsesAtom);
  const activeWorkspace = useActiveWorkspace();
  const httpResponses = useHttpResponses();
  const grpcConnections = useGrpcConnections();
  const labels = [
    httpResponses.length > 0 ? count('Http Response', httpResponses.length) : null,
    grpcConnections.length > 0 ? count('Grpc Connection', grpcConnections.length) : null,
  ].filter((l) => l != null);

  return useMutation({
    mutationKey: ['delete_send_history'],
    mutationFn: async () => {
      if (labels.length === 0) {
        alert({
          id: 'no-responses',
          title: 'Nothing to Delete',
          body: 'There are no Http Response or Grpc Connections to delete',
        });
        return;
      }

      const confirmed = await confirm({
        id: 'delete-send-history',
        title: 'Clear Send History',
        variant: 'delete',
        description: <>Delete {labels.join(' and ')}?</>,
      });
      if (!confirmed) return false;

      await invokeCmd('cmd_delete_send_history', { workspaceId: activeWorkspace?.id ?? 'n/a' });
      return true;
    },
    onSuccess: async (confirmed) => {
      if (!confirmed) return;

      setHttpResponses((all) => all.filter((r) => r.workspaceId !== activeWorkspace?.id));
    },
  });
}
