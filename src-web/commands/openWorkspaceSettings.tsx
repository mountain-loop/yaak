import { WorkspaceSettingsDialog } from '../components/WorkspaceSettingsDialog';
import { activeWorkspaceIdAtom } from '../hooks/useActiveWorkspace';
import { createFastMutation } from '../hooks/useFastMutation';
import { showDialog } from '../lib/dialog';
import { jotaiStore } from '../lib/jotai';

export const openWorkspaceSettings = createFastMutation<void, string, { openSyncMenu?: boolean }>({
  mutationKey: ['open_workspace_settings'],
  async mutationFn({ openSyncMenu }) {
    const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
    showDialog({
      id: 'workspace-settings',
      title: 'Workspace Settings',
      size: 'md',
      render({ hide }) {
        return (
          <WorkspaceSettingsDialog
            workspaceId={workspaceId}
            hide={hide}
            openSyncMenu={openSyncMenu}
          />
        );
      },
    });
  },
});
