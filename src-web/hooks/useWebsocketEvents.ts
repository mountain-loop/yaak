import { useQuery } from '@tanstack/react-query';
import type { WebsocketEvent } from '@yaakapp-internal/models';
import { listWebsocketEvents } from '@yaakapp-internal/ws';

export function websocketEventsQueryKey({ connectionId }: { connectionId: string }) {
  return ['websocket_events', { connectionId }];
}

export function useWebsocketEvents(connectionId: string | null) {
  return (
    useQuery<WebsocketEvent[]>({
      enabled: connectionId !== null,
      initialData: [],
      queryKey: websocketEventsQueryKey({ connectionId: connectionId ?? 'n/a' }),
      queryFn: () => {
        if (connectionId == null) return [] as WebsocketEvent[];
        return listWebsocketEvents({ connectionId });
      },
    }).data ?? []
  );
}
