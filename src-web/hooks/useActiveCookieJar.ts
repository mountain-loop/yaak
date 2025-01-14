import { useSearch } from '@tanstack/react-router';
import type { CookieJar } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai/index';
import { useEffect } from 'react';
import { jotaiStore } from '../lib/jotai';
import { setWorkspaceSearchParams } from '../lib/setWorkspaceSearchParams';
import { cookieJarsAtom, useCookieJars } from './useCookieJars';

export const QUERY_COOKIE_JAR_ID = 'cookie_jar_id';

export const activeCookieJarAtom = atom<CookieJar | null>(null);

export function useActiveCookieJar() {
  return useAtomValue(activeCookieJarAtom);
}

export function useSubscribeActiveCookieJarId() {
  const search = useSearch({ strict: false });
  const cookieJarId = search.cookie_jar_id;
  const cookieJars = useAtomValue(cookieJarsAtom);
  useEffect(() => {
    if (search == null) return; // Happens during Vite hot reload
    const activeCookieJar = cookieJars?.find((j) => j.id == cookieJarId) ?? null;
    jotaiStore.set(activeCookieJarAtom, activeCookieJar);
  }, [cookieJarId, cookieJars, search]);
}

export function getActiveCookieJar() {
  return jotaiStore.get(activeCookieJarAtom);
}

export function useEnsureActiveCookieJar() {
  const cookieJars = useCookieJars();
  const { cookie_jar_id: activeCookieJarId } = useSearch({ from: '/workspaces/$workspaceId/' });

  // Set the active cookie jar to the first one, if none set
  useEffect(() => {
    if (cookieJars == null) return; // Hasn't loaded yet

    if (cookieJars.find((j) => j.id === activeCookieJarId)) {
      return; // There's an active jar
    }

    const firstJar = cookieJars[0];
    if (firstJar == null) {
      console.log("Workspace doesn't have any cookie jars to activate");
      return;
    }

    // There's no active jar, so set it to the first one
    console.log('Defaulting active cookie jar to first jar', firstJar);
    setWorkspaceSearchParams({ cookie_jar_id: firstJar.id });

    // NOTE: We only run this on cookieJars to prevent data races when switching workspaces since a lot of
    //  things change when switching workspaces, and we don't currently have a good way to ensure that all
    //  stores have updated.
    // TODO: Create a global data store that can handle this case
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cookieJars]);
}
