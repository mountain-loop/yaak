import { VStack } from '../components/core/Stacks';
import { WorkspaceEncryptionSetting } from '../components/WorkspaceEncryptionSetting';
import { activeWorkspaceMetaAtom } from '../hooks/useActiveWorkspace';
import { showDialog } from './dialog';
import { jotaiStore } from './jotai';

export function showSetupWorkspaceEncryptionDialog() {
  const workspaceMeta = jotaiStore.get(activeWorkspaceMetaAtom);
  if (workspaceMeta == null) throw new Error('WorkspaceMeta does not exist');

  showDialog({
    id: 'workspace-encryption',
    title: 'Workspace Encryption',
    size: 'md',
    render: ({ hide }) => (
      <VStack space={3} className="pb-2" alignItems="end">
        <WorkspaceEncryptionSetting expanded onDone={hide} />
      </VStack>
    ),
  });
}
