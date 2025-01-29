import type { WebsocketRequest } from '@yaakapp-internal/models';
import { upsertWebsocketRequest as cmdUpsertWebsocketRequest } from '@yaakapp-internal/ws';
import { createFastMutation } from '../hooks/useFastMutation';
import { trackEvent } from '../lib/analytics';

export const upsertWebsocketRequest = createFastMutation<
  WebsocketRequest,
  void,
  Parameters<typeof cmdUpsertWebsocketRequest>[0]
>({
  mutationKey: ['upsert_workspace'],
  mutationFn: (request) => cmdUpsertWebsocketRequest(request),
  onSuccess: async (request) => {
    const isNew = request.createdAt == request.updatedAt;

    if (isNew) trackEvent('workspace', 'create');
    else trackEvent('workspace', 'update');
  },
});
