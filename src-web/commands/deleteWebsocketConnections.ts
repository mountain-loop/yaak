import type { WebsocketRequest } from '@yaakapp-internal/models';
import { deleteWebsocketConnections as cmdDeleteWebsocketConnections } from '@yaakapp-internal/ws';
import { createFastMutation } from '../hooks/useFastMutation';
import { trackEvent } from '../lib/analytics';

export const deleteWebsocketConnections = createFastMutation({
  mutationKey: ['delete_websocket_connections'],
  mutationFn: async function (request: WebsocketRequest) {
    return cmdDeleteWebsocketConnections(request.id);
  },
  onSuccess: async () => {
    trackEvent('websocket_connection', 'delete_many');
  },
});
