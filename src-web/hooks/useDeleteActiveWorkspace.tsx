import type { Workspace } from '@yaakapp-internal/models';
import { InlineCode } from '../components/core/InlineCode';
import { trackEvent } from '../lib/analytics';
import { showConfirmDelete } from '../lib/confirm';
import { router } from '../lib/router';
import { invokeCmd } from '../lib/tauri';
import { getActiveWorkspace } from './useActiveWorkspace';
import { useFastMutation } from './useFastMutation';

export function useDeleteActiveWorkspace() {
  return useFastMutation<Workspace | null, string>({
    mutationKey: ['delete_workspace'],
    mutationFn: async () => {
      const workspace = getActiveWorkspace();
      const confirmed = await showConfirmDelete({
        id: 'delete-workspace',
        title: 'Delete Workspace',
        description: (
          <>
            Permanently delete <InlineCode>{workspace?.name}</InlineCode>?
          </>
        ),
      });
      if (!confirmed) return null;
      return invokeCmd('cmd_delete_workspace', { workspaceId: workspace?.id });
    },
    onSettled: () => trackEvent('workspace', 'delete'),
    onSuccess: async (workspace) => {
      if (workspace === null) return;
      await router.navigate({ to: '/workspaces' });
    },
  });
}
