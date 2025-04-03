import { WorkspaceEncryptionSetting } from '../components/WorkspaceEncryptionSetting';
import { activeWorkspaceMetaAtom } from '../hooks/useActiveWorkspace';
import { showDialog } from './dialog';
import { jotaiStore } from './jotai';

export function showSetupWorkspaceEncryptionDialog() {
  const workspaceMeta = jotaiStore.get(activeWorkspaceMetaAtom);
  if (workspaceMeta == null) throw new Error('WorkspaceMeta does not exist');

  showDialog({
    id: 'workspace-encryption',
    title: workspaceMeta.encryptionKey ? 'Workspace Encryption' : 'Setup Workspace Encryption',
    size: 'sm',
    render: () => (
      <div className="pb-2">
        <WorkspaceEncryptionSetting expanded />
      </div>
    ),
  });
}
