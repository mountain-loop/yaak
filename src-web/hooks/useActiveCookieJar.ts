import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCookieJars } from './useCookieJars';

export const QUERY_COOKIE_JAR_ID = 'cookie_jar_id';

export function useActiveCookieJar() {
  const [activeCookieJarId, setActiveCookieJarId] = useActiveCookieJarId();
  const cookieJars = useCookieJars();

  const activeCookieJar = useMemo(() => {
    return cookieJars?.find((cookieJar) => cookieJar.id === activeCookieJarId) ?? null;
  }, [activeCookieJarId, cookieJars]);

  return [activeCookieJar ?? null, setActiveCookieJarId] as const;
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
    setActiveCookieJarId(firstJar.id);
  }, [activeCookieJarId, cookieJars, setActiveCookieJarId]);
}

function useActiveCookieJarId() {
  // NOTE: This query param is accessed from Rust side, so do not change
  const [params, setParams] = useSearchParams();
  const id = params.get(QUERY_COOKIE_JAR_ID);

  const setId = useCallback(
    (id: string) => {
      setParams((p) => {
        const existing = Object.fromEntries(p);
        return { ...existing, [QUERY_COOKIE_JAR_ID]: id };
      });
    },
    [setParams],
  );

  return [id, setId] as const;
}
