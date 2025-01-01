import { useNavigate, useSearch } from '@tanstack/react-router';
import type { CookieJar } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai/index';
import { useCallback, useEffect } from 'react';
import { jotaiStore } from '../lib/jotai';
import { cookieJarsAtom, useCookieJars } from './useCookieJars';

export const QUERY_COOKIE_JAR_ID = 'cookie_jar_id';

export const activeCookieJarIdAtom = atom<string>();

export const activeCookieJarAtom = atom<CookieJar | null>((get) => {
  const activeId = get(activeCookieJarIdAtom);
  return get(cookieJarsAtom)?.find((e) => e.id === activeId) ?? null;
});

export function useActiveCookieJar() {
  const navigate = useNavigate({ from: '/workspaces/$workspaceId' });
  const setId = useCallback(
    (id: string) =>
      navigate({
        search: (prev) => ({ ...prev, cookie_jar_id: id }),
      }),
    [navigate],
  );
  const cookieJar = useAtomValue(activeCookieJarAtom);
  return [cookieJar, setId] as const;
}

function useActiveCookieJarId() {
  // NOTE: This query param is accessed from Rust side, so do not change
  const { cookie_jar_id: id } = useSearch({ strict: false });
  const navigate = useNavigate({ from: '/workspaces/$workspaceId' });

  const setId = useCallback(
    (id: string) =>
      navigate({
        search: (prev) => ({ ...prev, cookie_jar_id: id }),
      }),
    [navigate],
  );

  return [id, setId] as const;
}

export function useSubscribeActiveCookieJarId() {
  const { cookie_jar_id } = useSearch({ strict: false });
  useEffect(() => {
    jotaiStore.set(activeCookieJarIdAtom, cookie_jar_id ?? undefined);
  }, [cookie_jar_id]);
}

export function getActiveCookieJar() {
  return jotaiStore.get(activeCookieJarAtom);
}

export function useEnsureActiveCookieJar() {
  const cookieJars = useCookieJars();
  const [activeCookieJarId, setActiveCookieJarId] = useActiveCookieJarId();

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
    console.log('Setting active cookie jar to', firstJar.id);
    setActiveCookieJarId(firstJar.id).catch(console.error);
  }, [activeCookieJarId, cookieJars, setActiveCookieJarId]);
}
