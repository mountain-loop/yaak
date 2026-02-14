import type { GrpcRequest, HttpRequest, WebsocketRequest } from '@yaakapp-internal/models';

import { BulkMoveToWorkspaceDialog } from '../components/BulkMoveToWorkspaceDialog';
import { activeWorkspaceIdAtom } from '../hooks/useActiveWorkspace';
import { createFastMutation } from '../hooks/useFastMutation';
import { showDialog } from '../lib/dialog';
import { jotaiStore } from '../lib/jotai';

export const bulkMoveToWorkspace = createFastMutation({
  mutationKey: ['bulk_move_workspace'],
  mutationFn: async (requests: (HttpRequest | GrpcRequest | WebsocketRequest)[]) => {
    const activeWorkspaceId = jotaiStore.get(activeWorkspaceIdAtom);
    if (activeWorkspaceId == null) return;

    // Filter out any invalid requests
    const validRequests = requests.filter(
      (r): r is HttpRequest | GrpcRequest | WebsocketRequest =>
        r != null && (r.model === 'http_request' || r.model === 'grpc_request' || r.model === 'websocket_request')
    );

    if (validRequests.length === 0) return;

    showDialog({
      id: 'bulk-change-workspace',
      title: `Move ${validRequests.length === 1 ? 'Request' : `${validRequests.length} Requests`}`,
      size: 'sm',
      render: ({ hide }) => (
        <BulkMoveToWorkspaceDialog
          onDone={hide}
          requests={validRequests}
          activeWorkspaceId={activeWorkspaceId}
        />
      ),
    });
  },
});
