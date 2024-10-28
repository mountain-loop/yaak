import { useMutation } from '@tanstack/react-query';
import { useSetAtom } from 'jotai';
import { trackEvent } from '../lib/analytics';
import { invokeCmd } from '../lib/tauri';
import { httpResponsesAtom } from './useHttpResponses';

export function useDeleteHttpResponses(requestId?: string) {
  const setHttpResponses = useSetAtom(httpResponsesAtom);
  return useMutation({
    mutationKey: ['delete_http_responses', requestId],
    mutationFn: async () => {
      if (requestId === undefined) return;
      await invokeCmd('cmd_delete_all_http_responses', { requestId });
    },
    onSuccess: () => {
      setHttpResponses((all) => all.filter((r) => r.requestId !== requestId));
    },
    onSettled: () => trackEvent('http_response', 'delete_many'),
  });
}
