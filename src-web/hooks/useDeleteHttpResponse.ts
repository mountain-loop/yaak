import { useMutation } from '@tanstack/react-query';
import type { HttpResponse } from '@yaakapp-internal/models';
import {useSetAtom} from "jotai";
import { trackEvent } from '../lib/analytics';
import { invokeCmd } from '../lib/tauri';
import {httpResponsesAtom} from "./useHttpResponses";
import {removeModelById} from "./useSyncModelStores";

export function useDeleteHttpResponse(id: string | null) {
  const setHttpResponses = useSetAtom(httpResponsesAtom);
  return useMutation<HttpResponse>({
    mutationKey: ['delete_http_response', id],
    mutationFn: async () => {
      return await invokeCmd('cmd_delete_http_response', { id: id });
    },
    onSettled: () => trackEvent('http_response', 'delete'),
    onSuccess: (response) => {
      setHttpResponses(removeModelById(response));
    }
  });
}
