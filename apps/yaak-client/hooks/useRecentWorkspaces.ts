import { workspacesAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { useEffect, useMemo } from 'react';
import { jotaiStore } from '../lib/jotai';
import { getKeyValue, setKeyValue } from '../lib/keyValueStore';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';
import { useKeyValue } from './useKeyValue';

const kvKey = () => 'recent_workspaces';
const namespace = 'global';
const fallback: string[] = [];

export function useRecentWorkspaces() {
  const workspaces = useAtomValue(workspacesAtom);
  const { value, isLoading } = useKeyValue<string[]>({ key: kvKey(), namespace, fallback });

  const onlyValidIds = useMemo(
    () => value?.filter((id) => workspaces.some((w) => w.id === id)) ?? [],
    [value, workspaces],
  );

  if (isLoading) return null;

  return onlyValidIds;
}

export function useSubscribeRecentWorkspaces() {
  useEffect(() => {
    const unsub = jotaiStore.sub(activeWorkspaceIdAtom, updateRecentWorkspaces);
    updateRecentWorkspaces().catch(console.error); // Update when opened in a new window
    return unsub;
  }, []);
}

async function updateRecentWorkspaces() {
  const activeWorkspaceId = jotaiStore.get(activeWorkspaceIdAtom);
  if (activeWorkspaceId == null) return;

  const key = kvKey();

  const recentIds = getKeyValue<string[]>({ namespace, key, fallback });
  if (recentIds[0] === activeWorkspaceId) return; // Short-circuit

  const withoutActiveId = recentIds.filter((id) => id !== activeWorkspaceId);
  const value = [activeWorkspaceId, ...withoutActiveId];
  console.log('Recent workspaces update', activeWorkspaceId);
  await setKeyValue({ namespace, key, value });
}
