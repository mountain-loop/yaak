import type { HttpRequest } from '@yaakapp-internal/models';
import { InlineCode } from '../components/core/InlineCode';
import { trackEvent } from '../lib/analytics';
import { showConfirm } from '../lib/confirm';
import { fallbackRequestName } from '../lib/fallbackRequestName';
import { invokeCmd } from '../lib/tauri';
import { useFastMutation } from './useFastMutation';

export function useDeleteAnyHttpRequest() {
  return useFastMutation<HttpRequest | null, string, HttpRequest>({
    mutationKey: ['delete_any_http_request'],
    mutationFn: async (request) => {
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
      if (!confirmed) {
        return null;
      }
      return invokeCmd<HttpRequest>('cmd_delete_http_request', { requestId: request.id });
    },
    onSuccess: () => trackEvent('http_request', 'delete'),
  });
}
