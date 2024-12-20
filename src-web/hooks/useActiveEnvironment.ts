import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useEnvironments } from './useEnvironments';

export function useActiveEnvironment() {
  const [id, setId] = useActiveEnvironmentId();
  const { subEnvironments } = useEnvironments();
  const environment = subEnvironments.find((w) => w.id === id) ?? null;
  return [environment, setId] as const;
}

export const QUERY_ENVIRONMENT_ID = 'environment_id';

function useActiveEnvironmentId() {
  // NOTE: This query param is accessed from Rust side, so do not change
  const [params, setParams] = useSearchParams();
  const id = params.get(QUERY_ENVIRONMENT_ID);

  const setId = useCallback(
    (id: string | null) => {
      setParams((p) => {
        const existing = Object.fromEntries(p);
        if (id == null) {
          delete existing[QUERY_ENVIRONMENT_ID];
        } else {
          existing[QUERY_ENVIRONMENT_ID] = id;
        }
        return existing;
      });
    },
    [setParams],
  );

  return [id, setId] as const;
}
