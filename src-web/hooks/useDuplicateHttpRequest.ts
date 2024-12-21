import { useMutation } from './useMutation';
import type { HttpRequest } from '@yaakapp-internal/models';
import { trackEvent } from '../lib/analytics';
import { invokeCmd } from '../lib/tauri';
import { router } from '../main';
import { Route } from '../routes/workspaces/$workspaceId/requests/$requestId';

export function useDuplicateHttpRequest({
  id,
  navigateAfter,
}: {
  id: string | null;
  navigateAfter: boolean;
}) {
  return useMutation<HttpRequest, string>({
    mutationKey: ['duplicate_http_request', id],
    mutationFn: async () => {
      if (id === null) throw new Error("Can't duplicate a null request");
      return invokeCmd('cmd_duplicate_http_request', { id });
    },
    onSettled: () => trackEvent('http_request', 'duplicate'),
    onSuccess: async (request) => {
      if (navigateAfter) {
        router.navigate({
          to: Route.fullPath,
          params: {
            workspaceId: request.workspaceId,
            requestId: request.id,
          },
          search: (prev) => ({ ...prev }),
        });
      }
    },
  });
}
