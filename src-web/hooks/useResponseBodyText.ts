import { useQuery } from '@tanstack/react-query';
import { getResponseBodyText } from '../lib/responseBody';

export function useResponseBodyText({
  responseId,
  filter,
}: {
  responseId: string;
  filter: string | null;
}) {
  return useQuery({
    queryKey: ['response_body_text', responseId, filter ?? ''],
    queryFn: () => getResponseBodyText({ responseId, filter }),
  });
}
