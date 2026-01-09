import { useAtomValue } from 'jotai';
import { activeWorkspaceMetaAtom } from './useActiveWorkspace';

export function useIsEncryptionEnabled() {
  const workspaceMeta = useAtomValue(activeWorkspaceMetaAtom);
  return workspaceMeta?.encryptionKey != null;
}
