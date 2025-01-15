import { useQuery } from '@tanstack/react-query';
import type { HttpResponse } from '@yaakapp-internal/models';
import type { ServerSentEvent } from '@yaakapp-internal/sse';
import { getResponseBodyEventSource } from '../lib/responseBody';

export function useResponseBodyEventSource(response: HttpResponse) {
  return useQuery<ServerSentEvent[]>({
    placeholderData: (prev) => prev, // Keep previous data on refetch
    queryKey: ['response-body-event-source', response.id, response.contentLength],
    queryFn: () => getResponseBodyEventSource(response),
  });
}
