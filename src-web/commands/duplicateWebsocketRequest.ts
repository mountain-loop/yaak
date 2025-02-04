import type { WebsocketRequest } from '@yaakapp-internal/models';
import { duplicateWebsocketRequest as cmdDuplicateWebsocketRequest } from '@yaakapp-internal/ws';
import { createFastMutation } from '../hooks/useFastMutation';
import { trackEvent } from '../lib/analytics';
import { router } from '../lib/router';

export const duplicateWebsocketRequest = createFastMutation({
  mutationKey: ['delete_websocket_connection'],
  mutationFn: async function (request: WebsocketRequest) {
    return cmdDuplicateWebsocketRequest(request.id);
  },
  onSuccess: async (request) => {
    trackEvent('websocket_request', 'duplicate');
    await router.navigate({
      to: '/workspaces/$workspaceId',
      params: { workspaceId: request.workspaceId },
      search: (prev) => ({ ...prev, request_id: request.id }),
    });
  },
});
