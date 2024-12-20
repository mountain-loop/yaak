import { useSearch } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import { Route } from '../routes/workspaces/$workspaceId';
import { useEnvironments } from './useEnvironments';

export function useActiveEnvironment() {
  const [id, setId] = useActiveEnvironmentId();
  const environments = useEnvironments();
  const environment = useMemo(
    () => environments.find((w) => w.id === id) ?? null,
    [environments, id],
  );
  return [environment, setId] as const;
}

export const QUERY_ENVIRONMENT_ID = 'environment_id';

function useActiveEnvironmentId() {
  // NOTE: This query param is accessed from Rust side, so do not change
  const navigate = Route.useNavigate();
  const { environmentId: id } = useSearch({ strict: false });

  const setId = useCallback(
    (environment_id: string | null) =>
      navigate({ search: (prev) => ({ ...prev, environment_id: environment_id ?? undefined }) }),
    [navigate],
  );

  return [id, setId] as const;
}
