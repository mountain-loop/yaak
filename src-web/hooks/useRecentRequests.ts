import { useEffect, useMemo } from 'react';
import { jotaiStore } from '../lib/jotai';
import { getKeyValue, setKeyValue } from '../lib/keyValueStore';
import { activeRequestIdAtom } from './useActiveRequestId';
import { activeWorkspaceIdAtom, useActiveWorkspace } from './useActiveWorkspace';
import { useKeyValue } from './useKeyValue';
import { useRequests } from './useRequests';

const kvKey = (workspaceId: string) => 'recent_requests::' + workspaceId;
const namespace = 'global';
const fallback: string[] = [];

export function useRecentRequests() {
  const requests = useRequests();
  const activeWorkspace = useActiveWorkspace();

  const { set: setRecentRequests, value: recentRequests } = useKeyValue<string[]>({
    key: kvKey(activeWorkspace?.id ?? 'n/a'),
    namespace,
    fallback,
  });

  const onlyValidIds = useMemo(
    () => recentRequests?.filter((id) => requests.some((r) => r.id === id)) ?? [],
    [recentRequests, requests],
  );

  return [onlyValidIds, setRecentRequests] as const;
}

export function useSubscribeRecentRequests() {
  useEffect(() => {
    return jotaiStore.sub(activeRequestIdAtom, async () => {
      const activeWorkspaceId = jotaiStore.get(activeWorkspaceIdAtom);
      const activeRequestId = jotaiStore.get(activeRequestIdAtom);
      if (activeWorkspaceId == null) return;
      if (activeRequestId == null) return;

      const key = kvKey(activeWorkspaceId);

      const recentIds = await getKeyValue<string[]>({ namespace, key, fallback });
      if (recentIds[0] === activeRequestId) return; // Short-circuit

      const withoutActiveId = recentIds.filter((id) => id !== activeRequestId);
      const value = [activeRequestId, ...withoutActiveId];
      await setKeyValue({ namespace, key, value });
    });
  }, []);
}

export async function getRecentRequests(workspaceId: string) {
  return getKeyValue<string[]>({
    namespace,
    key: kvKey(workspaceId),
    fallback,
  });
}
