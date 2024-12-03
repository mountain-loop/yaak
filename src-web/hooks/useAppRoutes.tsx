import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { SettingsTab } from '../components/Settings/Settings';
import { QUERY_COOKIE_JAR_ID } from './useActiveCookieJar';
import { QUERY_ENVIRONMENT_ID } from './useActiveEnvironment';

export type RouteParamsWorkspace = {
  workspaceId: string;
  environmentId: string | null;
  cookieJarId: string | null;
};

export type RouteParamsRequest = RouteParamsWorkspace & {
  requestId: string;
};

export type RouteParamsSettings = {
  workspaceId: string;
  tab?: SettingsTab;
};

export const paths = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  workspaces(_ = {}) {
    return '/workspaces';
  },
  workspaceSettings({ workspaceId, tab } = { workspaceId: ':workspaceId' } as RouteParamsSettings) {
    return `/workspaces/${workspaceId}/settings?tab=${tab ?? SettingsTab.General}`;
  },
  workspace(
    { workspaceId, environmentId, cookieJarId } = {
      workspaceId: ':workspaceId',
      environmentId: ':environmentId',
      cookieJarId: ':cookieJarId',
    } as RouteParamsWorkspace,
  ) {
    const path = `/workspaces/${workspaceId}`;
    const params = new URLSearchParams();
    if (environmentId != null) params.set(QUERY_ENVIRONMENT_ID, environmentId);
    if (cookieJarId != null) params.set(QUERY_COOKIE_JAR_ID, cookieJarId);
    return `${path}?${params}`;
  },
  request(
    { workspaceId, environmentId, requestId, cookieJarId } = {
      workspaceId: ':workspaceId',
      environmentId: ':environmentId',
      requestId: ':requestId',
    } as RouteParamsRequest,
  ) {
    const path = `/workspaces/${workspaceId}/requests/${requestId}`;
    const params = new URLSearchParams();
    if (environmentId != null) params.set(QUERY_ENVIRONMENT_ID, environmentId);
    if (cookieJarId != null) params.set(QUERY_COOKIE_JAR_ID, cookieJarId);
    return `${path}?${params}`;
  },
};

export function useAppRoutes() {
  const nav = useNavigate();

  const navigate = useCallback(
    <T extends keyof typeof paths>(path: T, ...params: Parameters<(typeof paths)[T]>) => {
      // Not sure how to make TS work here, but it's good from the
      // outside caller perspective.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resolvedPath = paths[path](...(params as any));
      nav(resolvedPath);
    },
    [nav],
  );

  return {
    paths,
    navigate,
  };
}
