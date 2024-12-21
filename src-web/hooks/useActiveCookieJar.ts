import { getRouteApi, useSearch } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo } from 'react';
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
    setActiveCookieJarId(firstJar.id).catch(console.error);
  }, [activeCookieJarId, cookieJars, setActiveCookieJarId]);
}

const routeApi = getRouteApi('/workspaces/$workspaceId/');

function useActiveCookieJarId() {
  // NOTE: This query param is accessed from Rust side, so do not change
  const { cookieJarId: id } = useSearch({ strict: false });
  const navigate = routeApi.useNavigate();

  const setId = useCallback(
    (id: string) =>
      navigate({
        search: (prev) => ({ ...prev, cookieJarId: id }),
      }),
    [navigate],
  );

  return [id, setId] as const;
}
