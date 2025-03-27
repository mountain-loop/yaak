import type { Workspace } from '@yaakapp-internal/models';
import { InlineCode } from '../components/core/InlineCode';
import { showConfirmDelete } from '../lib/confirm';
import { jotaiStore } from '../lib/jotai';
import { router } from '../lib/router';
import { invokeCmd } from '../lib/tauri';
import { activeWorkspaceAtom } from './useActiveWorkspace';
import { useFastMutation } from './useFastMutation';

export function useDeleteActiveWorkspace() {
  return useFastMutation<Workspace | null, string>({
    mutationKey: ['delete_workspace'],
    mutationFn: async () => {
      const workspace = jotaiStore.get(activeWorkspaceAtom);
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
    onSuccess: async (workspace) => {
      if (workspace === null) return;
      await router.navigate({ to: '/workspaces' });
    },
  });
}
