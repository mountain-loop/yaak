import { useAtomValue } from 'jotai';
import { activeWorkspaceAtom } from './useActiveWorkspace';
import { useKeyValue } from './useKeyValue';

export function useFloatingSidebarHidden() {
  const activeWorkspace = useAtomValue(activeWorkspaceAtom);
  const { set, value } = useKeyValue<boolean>({
    namespace: 'no_sync',
    key: ['floating_sidebar_hidden', activeWorkspace?.id ?? 'n/a'],
    fallback: false,
  });

  return [value, set] as const;
}
