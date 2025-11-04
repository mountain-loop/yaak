import { useEffect, useMemo } from 'react';
import { jotaiStore } from '../lib/jotai';
import { getKeyValue, setKeyValue } from '../lib/keyValueStore';
import { activeEnvironmentAtom } from './useActiveEnvironment';
import { useEnvironmentsBreakdown } from './useEnvironmentsBreakdown';
import { useKeyValue } from './useKeyValue';

const kvKey = (workspaceId: string) => 'recent_environments::' + workspaceId;
const namespace = 'global';
const fallback: string[] = [];

export function useRecentEnvironments() {
  const { subEnvironments, allEnvironments } = useEnvironmentsBreakdown();
  const kv = useKeyValue<string[]>({
    key: kvKey(allEnvironments[0]?.workspaceId ?? 'n/a'),
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
    return jotaiStore.sub(activeEnvironmentAtom, async () => {
      const activeEnvironment = jotaiStore.get(activeEnvironmentAtom);
      if (activeEnvironment == null) return;

      const key = kvKey(activeEnvironment.workspaceId);
      const recentIds = getKeyValue<string[]>({ namespace, key, fallback });
      if (recentIds[0] === activeEnvironment.id) return; // Short-circuit

      const withoutActiveId = recentIds.filter((id) => id !== activeEnvironment.id);
      const value = [activeEnvironment.id, ...withoutActiveId];
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
