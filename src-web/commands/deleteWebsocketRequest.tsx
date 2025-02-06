import type { WebsocketRequest } from '@yaakapp-internal/models';
import { deleteWebsocketRequest as cmdDeleteWebsocketRequest } from '@yaakapp-internal/ws';
import { InlineCode } from '../components/core/InlineCode';
import { createFastMutation } from '../hooks/useFastMutation';
import { trackEvent } from '../lib/analytics';
import { showConfirmDelete } from '../lib/confirm';
import { fallbackRequestName } from '../lib/fallbackRequestName';

export const deleteWebsocketRequest = createFastMutation({
  mutationKey: ['delete_websocket_request'],
  mutationFn: async (request: WebsocketRequest) => {
    const confirmed = await showConfirmDelete({
      id: 'delete-websocket-request',
      title: 'Delete WebSocket Request',
      description: (
        <>
          Permanently delete <InlineCode>{fallbackRequestName(request)}</InlineCode>?
        </>
      ),
    });
    if (!confirmed) {
      return null;
    }

    return cmdDeleteWebsocketRequest(request.id);
  },
  onSuccess: async () => {
    trackEvent('websocket_request', 'delete');
  },
});
