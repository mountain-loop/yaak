import { useEffect, useMemo } from 'react';
import { jotaiStore } from '../lib/jotai';
import { getKeyValue, setKeyValue } from '../lib/keyValueStore';
import { activeCookieJarIdAtom } from './useActiveCookieJar';
import { activeWorkspaceIdAtom, useActiveWorkspace } from './useActiveWorkspace';
import { useCookieJars } from './useCookieJars';
import { useKeyValue } from './useKeyValue';

const kvKey = (workspaceId: string) => 'recent_cookie_jars::' + workspaceId;
const namespace = 'global';
const fallback: string[] = [];

export function useRecentCookieJars() {
  const cookieJars = useCookieJars();
  const activeWorkspace = useActiveWorkspace();
  const kv = useKeyValue<string[]>({
    key: kvKey(activeWorkspace?.id ?? 'n/a'),
    namespace,
    fallback,
  });

  const onlyValidIds = useMemo(
    () => kv.value?.filter((id) => cookieJars?.some((e) => e.id === id)) ?? [],
    [kv.value, cookieJars],
  );

  return onlyValidIds;
}

export function useSubscribeRecentCookieJars() {
  useEffect(() => {
    return jotaiStore.sub(activeCookieJarIdAtom, async () => {
      const activeWorkspaceId = jotaiStore.get(activeWorkspaceIdAtom);
      const activeCookieJarId = jotaiStore.get(activeCookieJarIdAtom);
      if (activeWorkspaceId == null) return;
      if (activeCookieJarId == null) return;

      const key = kvKey(activeWorkspaceId);

      const recentIds = await getKeyValue<string[]>({ namespace, key, fallback });
      if (recentIds[0] === activeCookieJarId) return; // Short-circuit

      const withoutActiveId = recentIds.filter((id) => id !== activeCookieJarId);
      const value = [activeCookieJarId, ...withoutActiveId];
      await setKeyValue({ namespace, key, value });
    });
  }, []);
}

export async function getRecentCookieJars(workspaceId: string) {
  return getKeyValue<string[]>({
    namespace,
    key: kvKey(workspaceId),
    fallback,
  });
}
