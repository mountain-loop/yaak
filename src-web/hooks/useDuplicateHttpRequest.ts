import { useNavigate } from '@tanstack/react-router';
import type { HttpRequest } from '@yaakapp-internal/models';
import { trackEvent } from '../lib/analytics';
import { invokeCmd } from '../lib/tauri';
import { useFastMutation } from './useFastMutation';

export function useDuplicateHttpRequest({
  id,
  navigateAfter,
}: {
  id: string | null;
  navigateAfter: boolean;
}) {
  const navigate = useNavigate();
  return useFastMutation<HttpRequest, string>({
    mutationKey: ['duplicate_http_request', id],
    mutationFn: async () => {
      if (id === null) throw new Error("Can't duplicate a null request");
      return invokeCmd('cmd_duplicate_http_request', { id });
    },
    onSettled: () => trackEvent('http_request', 'duplicate'),
    onSuccess: async (request) => {
      if (navigateAfter) {
        await navigate({
          to: '/workspaces/$workspaceId/requests/$requestId',
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
