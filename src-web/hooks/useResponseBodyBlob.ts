import { useQuery } from '@tanstack/react-query';
import type { HttpResponse } from '@yaakapp-internal/models';
import { getResponseBodyBlob } from '../lib/responseBody';

export function useResponseBodyBlob(response: HttpResponse) {
  return useQuery<Uint8Array | null>({
    enabled: response != null,
    queryKey: ['response-body-binary', response?.updatedAt],
    initialData: null,
    queryFn: () => getResponseBodyBlob(response),
  }).data;
}
