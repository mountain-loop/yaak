import { getRouteApi, useSearch } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useEnvironments } from './useEnvironments';

export function useActiveEnvironment() {
  const [id, setId] = useActiveEnvironmentId();
  const { subEnvironments } = useEnvironments();
  const environment = subEnvironments.find((w) => w.id === id) ?? null;
  return [environment, setId] as const;
}

export const QUERY_ENVIRONMENT_ID = 'environment_id';

const routeApi = getRouteApi('/workspaces/$workspaceId/');

function useActiveEnvironmentId() {
  // NOTE: This query param is accessed from Rust side, so do not change
  const { environmentId: id } = useSearch({ strict: false });
  const navigate = routeApi.useNavigate();

  const setId = useCallback(
    (environment_id: string | null) =>
      navigate({
        search: (prev) => ({ ...prev, environment_id: environment_id ?? undefined }),
      }),
    [navigate],
  );

  return [id, setId] as const;
}
