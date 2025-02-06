import type { GrpcRequest } from '@yaakapp-internal/models';
import { InlineCode } from '../components/core/InlineCode';
import { trackEvent } from '../lib/analytics';
import { showConfirmDelete } from '../lib/confirm';
import { fallbackRequestName } from '../lib/fallbackRequestName';
import { invokeCmd } from '../lib/tauri';
import { useFastMutation } from './useFastMutation';

export function useDeleteAnyGrpcRequest() {
  return useFastMutation<GrpcRequest | null, string, GrpcRequest>({
    mutationKey: ['delete_any_grpc_request'],
    mutationFn: async (request) => {
      const confirmed = await showConfirmDelete({
        id: 'delete-grpc-request',
        title: 'Delete Request',
        description: (
          <>
            Permanently delete <InlineCode>{fallbackRequestName(request)}</InlineCode>?
          </>
        ),
      });
      if (!confirmed) {
        return null;
      }
      return invokeCmd('cmd_delete_grpc_request', { requestId: request.id });
    },
    onSuccess: () => trackEvent('grpc_request', 'delete'),
  });
}
