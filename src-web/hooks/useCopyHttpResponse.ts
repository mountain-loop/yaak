import { useFastMutation } from './useFastMutation';
import type { HttpResponse } from '@yaakapp-internal/models';
import { useCopy } from './useCopy';
import { getResponseBodyText } from '../lib/responseBody';

export function useCopyHttpResponse(response: HttpResponse) {
  const copy = useCopy();
  return useFastMutation({
    mutationKey: ['copy_http_response'],
    async mutationFn() {
      const body = await getResponseBodyText(response);
      copy(body);
    },
  });
}
