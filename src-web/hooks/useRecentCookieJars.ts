import { cookieJarsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { useEffect, useMemo } from 'react';
import { jotaiStore } from '../lib/jotai';
import { getKeyValue, setKeyValue } from '../lib/keyValueStore';
import { activeCookieJarAtom } from './useActiveCookieJar';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';
import { useKeyValue } from './useKeyValue';

const kvKey = (workspaceId: string) => 'recent_cookie_jars::' + workspaceId;
const namespace = 'global';
const fallback: string[] = [];

export function useRecentCookieJars() {
  const cookieJars = useAtomValue(cookieJarsAtom);
  const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom);
  const kv = useKeyValue<string[]>({
    key: kvKey(activeWorkspaceId ?? 'n/a'),
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
    return jotaiStore.sub(activeCookieJarAtom, async () => {
      const activeWorkspaceId = jotaiStore.get(activeWorkspaceIdAtom);
      const activeCookieJarId = jotaiStore.get(activeCookieJarAtom)?.id ?? null;
      if (activeWorkspaceId == null) return;
      if (activeCookieJarId == null) return;

      const key = kvKey(activeWorkspaceId);

      const recentIds = getKeyValue<string[]>({ namespace, key, fallback });
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
