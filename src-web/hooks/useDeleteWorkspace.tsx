import { useNavigate } from '@tanstack/react-router';
import type { Workspace } from '@yaakapp-internal/models';
import { useSetAtom } from 'jotai';
import { InlineCode } from '../components/core/InlineCode';
import { trackEvent } from '../lib/analytics';
import { invokeCmd } from '../lib/tauri';
import { getActiveWorkspace } from './useActiveWorkspace';
import { useConfirm } from './useConfirm';
import { useFastMutation } from './useFastMutation';
import { removeModelById } from './useSyncModelStores';
import { workspacesAtom } from './useWorkspaces';

export function useDeleteWorkspace() {
  const confirm = useConfirm();
  const setWorkspaces = useSetAtom(workspacesAtom);
  const navigate = useNavigate();

  return useFastMutation<Workspace | null, string>({
    mutationKey: ['delete_workspace'],
    mutationFn: async () => {
      const workspace = getActiveWorkspace();
      const confirmed = await confirm({
        id: 'delete-workspace',
        title: 'Delete Workspace',
        variant: 'delete',
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

      // Optimistic update
      setWorkspaces(removeModelById(workspace));

      const { id: workspaceId } = workspace;
      const activeWorkspace = getActiveWorkspace();
      if (workspaceId === activeWorkspace?.id) {
        await navigate({ to: '/workspaces' });
      }
    },
  });
}
