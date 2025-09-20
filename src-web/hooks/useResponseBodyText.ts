import { useQuery } from '@tanstack/react-query';
import type { HttpResponse } from '@yaakapp-internal/models';
import { getResponseBodyText } from '../lib/responseBody';

export function useResponseBodyText({
  response,
  filter,
}: {
  response: HttpResponse;
  filter: string | null;
}) {
  return useQuery({
    queryKey: [
      'response_body_text',
      response.id,
      response.updatedAt,
      response.contentLength,
      filter ?? '',
    ],
    queryFn: () => getResponseBodyText({ responseId: response.id, filter }),
  });
}
