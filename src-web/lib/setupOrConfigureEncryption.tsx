import { VStack } from '../components/core/Stacks';
import { WorkspaceEncryptionSetting } from '../components/WorkspaceEncryptionSetting';
import { activeWorkspaceMetaAtom } from '../hooks/useActiveWorkspace';
import { showDialog } from './dialog';
import { jotaiStore } from './jotai';

export function setupOrConfigureEncryption() {
  setupOrConfigure();
}

export function withEncryptionEnabled(callback?: () => void) {
  const workspaceMeta = jotaiStore.get(activeWorkspaceMetaAtom);
  if (workspaceMeta?.encryptionKey != null) {
    callback?.(); // Already set up
    return;
  }

  setupOrConfigure(callback);
}

function setupOrConfigure(onEnable?: () => void) {
  showDialog({
    id: 'workspace-encryption',
    title: 'Workspace Encryption',
    size: 'md',
    render: ({ hide }) => (
      <VStack space={3} className="pb-2" alignItems="end">
        <WorkspaceEncryptionSetting expanded onDone={hide} onEnabledEncryption={onEnable} />
      </VStack>
    ),
  });
}
