import { useEffect, useMemo } from 'react';
import { jotaiStore } from '../lib/jotai';
import { getKeyValue, setKeyValue } from '../lib/keyValueStore';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';
import { useKeyValue } from './useKeyValue';
import { useWorkspaces } from './useWorkspaces';

const kvKey = () => 'recent_workspaces';
const namespace = 'global';
const fallback: string[] = [];

export function useRecentWorkspaces() {
  const workspaces = useWorkspaces();
  const { value, isLoading } = useKeyValue<string[]>({ key: kvKey(), namespace, fallback });

  const onlyValidIds = useMemo(
    () => value?.filter((id) => workspaces.some((w) => w.id === id)) ?? [],
    [value, workspaces],
  );


  console.log("HELLO", {isLoading, value})
  if (isLoading) return null;

  return onlyValidIds;
}

export function useSubscribeRecentWorkspaces() {
  useEffect(() => {
    return jotaiStore.sub(activeWorkspaceIdAtom, async () => {
      const activeWorkspaceId = jotaiStore.get(activeWorkspaceIdAtom);
      console.log("AAA");
      if (activeWorkspaceId == null) return;

      const key = kvKey();

      const recentIds = await getKeyValue<string[]>({ namespace, key, fallback });
      console.log("BBB", recentIds, activeWorkspaceId);
      if (recentIds[0] === activeWorkspaceId) return; // Short-circuit

      const withoutActiveId = recentIds.filter((id) => id !== activeWorkspaceId);
      const value = [activeWorkspaceId, ...withoutActiveId];
      console.log("SET ACTIVE WORCENT", value);
      await setKeyValue({ namespace, key, value });
    });
  }, []);
}
