import { invokeCmd } from '../lib/tauri';
import { useFastMutation } from './useFastMutation';

export function useDeleteHttpResponses(requestId?: string) {
  return useFastMutation({
    mutationKey: ['delete_http_responses', requestId],
    mutationFn: async () => {
      if (requestId === undefined) return;
      await invokeCmd('cmd_delete_all_http_responses', { requestId });
    },
  });
}
