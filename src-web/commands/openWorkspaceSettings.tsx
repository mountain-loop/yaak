import { WorkspaceSettingsDialog } from '../components/WorkspaceSettingsDialog';
import { getActiveWorkspaceId } from '../hooks/useActiveWorkspace';
import { createFastMutation } from '../hooks/useFastMutation';
import { showDialog } from '../lib/dialog';

export const openWorkspaceSettings = createFastMutation<void, string, { openSyncMenu?: boolean }>({
  mutationKey: ['open_workspace_settings'],
  async mutationFn({ openSyncMenu }) {
    const workspaceId = getActiveWorkspaceId();
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
