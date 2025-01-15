import type { HttpRequest } from '@yaakapp-internal/models';
import { InlineCode } from '../components/core/InlineCode';
import { trackEvent } from '../lib/analytics';
import { showConfirm } from '../lib/confirm';
import { fallbackRequestName } from '../lib/fallbackRequestName';
import { getHttpRequest } from '../lib/store';
import { invokeCmd } from '../lib/tauri';
import { useFastMutation } from './useFastMutation';

export function useDeleteAnyHttpRequest() {
  return useFastMutation<HttpRequest | null, string, string>({
    mutationKey: ['delete_any_http_request'],
    mutationFn: async (id) => {
      const request = await getHttpRequest(id);
      if (request == null) return null;

      const confirmed = await showConfirm({
        id: 'delete-request',
        title: 'Delete Request',
        variant: 'delete',
        description: (
          <>
            Permanently delete <InlineCode>{fallbackRequestName(request)}</InlineCode>?
          </>
        ),
      });
      if (!confirmed) return null;
      return invokeCmd<HttpRequest>('cmd_delete_http_request', { requestId: id });
    },
    onSettled: () => trackEvent('http_request', 'delete'),
  });
}
