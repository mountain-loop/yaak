import { useQuery } from '@tanstack/react-query';
import type { HttpResponse } from '@yaakapp-internal/models';
import { getResponseBodyBytes, getResponseBodyText } from '../lib/responseBody';

export function useResponseBodyText({
  response,
  filter,
}: {
  response: HttpResponse;
  filter: string | null;
}) {
  return useQuery({
    placeholderData: (prev) => prev, // Keep previous data on refetch
    queryKey: [
      'response_body_text',
      response.id,
      response.updatedAt,
      response.contentLength,
      filter ?? '',
    ],
    queryFn: () => getResponseBodyText({ response, filter }),
  });
}

export function useResponseBodyBytes({ response }: { response: HttpResponse }) {
  return useQuery({
    placeholderData: (prev) => prev, // Keep previous data on refetch
    queryKey: ['response_body_bytes', response.id, response.updatedAt, response.contentLength],
    queryFn: () => getResponseBodyBytes(response),
  });
}
