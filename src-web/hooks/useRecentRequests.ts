import { useEffect, useMemo } from 'react';
import { jotaiStore } from '../lib/jotai';
import { getKeyValue, setKeyValue } from '../lib/keyValueStore';
import { useKeyValue } from './useKeyValue';
import { useAllRequests } from './useAllRequests';
import { activeRequestAtom } from './useActiveRequest';

const kvKey = (workspaceId: string) => 'recent_requests::' + workspaceId;
const namespace = 'global';
const fallback: string[] = [];

export function useRecentRequests() {
  const requests = useAllRequests();

  const { set: setRecentRequests, value: recentRequests } = useKeyValue<string[]>({
    key: kvKey(requests[0]?.workspaceId ?? 'n/a'),
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
    return jotaiStore.sub(activeRequestAtom, async () => {
      const activeRequest = jotaiStore.get(activeRequestAtom);
      if (activeRequest == null) return;

      const key = kvKey(activeRequest.workspaceId);

      const recentIds = getKeyValue<string[]>({ namespace, key, fallback });
      if (recentIds[0] === activeRequest.id) return; // Short-circuit

      const withoutActiveId = recentIds.filter((id) => id !== activeRequest.id);
      const value = [activeRequest.id, ...withoutActiveId];
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
