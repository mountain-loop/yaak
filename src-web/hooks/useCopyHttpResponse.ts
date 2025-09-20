import type { HttpResponse } from '@yaakapp-internal/models';
import { copyToClipboard } from '../lib/copy';
import { getResponseBodyText } from '../lib/responseBody';
import { useFastMutation } from './useFastMutation';

export function useCopyHttpResponse(response: HttpResponse) {
  return useFastMutation({
    mutationKey: ['copy_http_response', response.id],
    async mutationFn() {
      const body = await getResponseBodyText({ responseId: response.id, filter: null });
      copyToClipboard(body);
    },
  });
}
