import type { WebsocketConnection } from '@yaakapp-internal/models';
import { deleteWebsocketConnection as cmdDeleteWebsocketConnection } from '@yaakapp-internal/ws';
import { createFastMutation } from '../hooks/useFastMutation';
import { trackEvent } from '../lib/analytics';

export const deleteWebsocketConnection = createFastMutation({
  mutationKey: ['delete_websocket_connection'],
  mutationFn: async function (connection: WebsocketConnection) {
    return cmdDeleteWebsocketConnection(connection.id);
  },
  onSuccess: async () => {
    trackEvent('websocket_connection', 'delete');
  },
});
