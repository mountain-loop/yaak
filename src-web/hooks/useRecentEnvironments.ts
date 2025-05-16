import { useAtomValue } from 'jotai';
import { useEffect, useMemo } from 'react';
import { jotaiStore } from '../lib/jotai';
import { getKeyValue, setKeyValue } from '../lib/keyValueStore';
import { activeEnvironmentIdAtom } from './useActiveEnvironment';
import { activeWorkspaceAtom, activeWorkspaceIdAtom } from './useActiveWorkspace';
import { useEnvironmentsBreakdown } from './useEnvironmentsBreakdown';
import { useKeyValue } from './useKeyValue';

const kvKey = (workspaceId: string) => 'recent_environments::' + workspaceId;
const namespace = 'global';
const fallback: string[] = [];

export function useRecentEnvironments() {
  const { subEnvironments } = useEnvironmentsBreakdown();
  const activeWorkspace = useAtomValue(activeWorkspaceAtom);
  const kv = useKeyValue<string[]>({
    key: kvKey(activeWorkspace?.id ?? 'n/a'),
    namespace,
    fallback,
  });

  const onlyValidIds = useMemo(
    () => kv.value?.filter((id) => subEnvironments.some((e) => e.id === id)) ?? [],
    [kv.value, subEnvironments],
  );

  return onlyValidIds;
}

export function useSubscribeRecentEnvironments() {
  useEffect(() => {
    return jotaiStore.sub(activeEnvironmentIdAtom, async () => {
      const activeWorkspaceId = jotaiStore.get(activeWorkspaceIdAtom);
      const activeEnvironmentId = jotaiStore.get(activeEnvironmentIdAtom);
      if (activeWorkspaceId == null) return;
      if (activeEnvironmentId == null) return;

      const key = kvKey(activeWorkspaceId);

      const recentIds = getKeyValue<string[]>({ namespace, key, fallback });
      if (recentIds[0] === activeEnvironmentId) return; // Short-circuit

      const withoutActiveId = recentIds.filter((id) => id !== activeEnvironmentId);
      const value = [activeEnvironmentId, ...withoutActiveId];
      await setKeyValue({ namespace, key, value });
    });
  }, []);
}

export async function getRecentEnvironments(workspaceId: string) {
  return getKeyValue<string[]>({
    namespace,
    key: kvKey(workspaceId),
    fallback,
  });
}
