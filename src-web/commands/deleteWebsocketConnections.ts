import type { WebsocketRequest } from '@yaakapp-internal/models';
import { deleteWebsocketConnections as cmdDeleteWebsocketConnections } from '@yaakapp-internal/ws';
import { createFastMutation } from '../hooks/useFastMutation';

export const deleteWebsocketConnections = createFastMutation({
  mutationKey: ['delete_websocket_connections'],
  mutationFn: async (request: WebsocketRequest) => cmdDeleteWebsocketConnections(request.id),
});
