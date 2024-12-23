import { useEffect, useMemo } from 'react';
import { getKeyValue } from '../lib/keyValueStore';
import { useActiveWorkspace } from './useActiveWorkspace';
import { useKeyValue } from './useKeyValue';
import { useWorkspaces } from './useWorkspaces';

const kvKey = () => 'recent_workspaces';
const namespace = 'global';
const fallback: string[] = [];

export function useRecentWorkspaces() {
  const workspaces = useWorkspaces();
  const activeWorkspace = useActiveWorkspace();
  const {value, set} = useKeyValue<string[]>({
    key: kvKey(),
    namespace,
    fallback,
  });

  // Set history when active request changes
  useEffect(() => {
    set((currentHistory: string[]) => {
      if (activeWorkspace === null) return currentHistory;
      const withoutCurrent = currentHistory.filter((id) => id !== activeWorkspace.id);
      return [activeWorkspace.id, ...withoutCurrent];
    }).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace]);

  const onlyValidIds = useMemo(
    () => value?.filter((id) => workspaces.some((w) => w.id === id)) ?? [],
    [value, workspaces],
  );

  return onlyValidIds;
}

export async function getRecentWorkspaces() {
  return getKeyValue<string[]>({
    namespace,
    key: kvKey(),
    fallback: fallback,
  });
}
