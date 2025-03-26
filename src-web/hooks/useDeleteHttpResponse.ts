import type { HttpResponse } from '@yaakapp-internal/models';
import { invokeCmd } from '../lib/tauri';
import { useFastMutation } from './useFastMutation';

export function useDeleteHttpResponse(id: string | null) {
  return useFastMutation<HttpResponse>({
    mutationKey: ['delete_http_response', id],
    mutationFn: async () => {
      return await invokeCmd('cmd_delete_http_response', { id: id });
    },
  });
}
