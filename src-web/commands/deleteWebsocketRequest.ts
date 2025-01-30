import { deleteWebsocketRequest as cmdDeleteWebsocketRequest } from '@yaakapp-internal/ws';
import { createFastMutation } from '../hooks/useFastMutation';
import { trackEvent } from '../lib/analytics';

export const deleteWebsocketRequest = createFastMutation({
  mutationKey: ['delete_websocket_request'],
  mutationFn: (requestId: string) => cmdDeleteWebsocketRequest(requestId),
  onSuccess: async () => {
    trackEvent('websocket_request', 'delete');
  },
});
