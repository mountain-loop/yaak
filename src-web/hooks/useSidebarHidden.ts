import { useAtomValue } from 'jotai';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';
import { useKeyValue } from './useKeyValue';

export function useSidebarHidden() {
  const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom);
  const { set, value } = useKeyValue<boolean>({
    namespace: 'no_sync',
    key: ['sidebar_hidden', activeWorkspaceId ?? 'n/a'],
    fallback: false,
  });

  return [value, set] as const;
}
