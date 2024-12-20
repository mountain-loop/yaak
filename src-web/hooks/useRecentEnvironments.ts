import { useEffect, useMemo } from 'react';
import { getKeyValue } from '../lib/keyValueStore';
import { useActiveEnvironment } from './useActiveEnvironment';
import { useActiveWorkspace } from './useActiveWorkspace';
import { useEnvironments } from './useEnvironments';
import { useKeyValue } from './useKeyValue';

const kvKey = (workspaceId: string) => 'recent_environments::' + workspaceId;
const namespace = 'global';
const fallback: string[] = [];

export function useRecentEnvironments() {
  const { subEnvironments } = useEnvironments();
  const activeWorkspace = useActiveWorkspace();
  const [activeEnvironment] = useActiveEnvironment();
  const kv = useKeyValue<string[]>({
    key: kvKey(activeWorkspace?.id ?? 'n/a'),
    namespace,
    fallback,
  });

  // Set history when active request changes
  useEffect(() => {
    kv.set((currentHistory: string[]) => {
      if (activeEnvironment === null) return currentHistory;
      const withoutCurrentEnvironment = currentHistory.filter((id) => id !== activeEnvironment.id);
      return [activeEnvironment.id, ...withoutCurrentEnvironment];
    }).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEnvironment?.id]);

  const onlyValidIds = useMemo(
    () => kv.value?.filter((id) => subEnvironments.some((e) => e.id === id)) ?? [],
    [kv.value, subEnvironments],
  );

  return onlyValidIds;
}

export async function getRecentEnvironments(workspaceId: string) {
  return getKeyValue<string[]>({
    namespace,
    key: kvKey(workspaceId),
    fallback,
  });
}
