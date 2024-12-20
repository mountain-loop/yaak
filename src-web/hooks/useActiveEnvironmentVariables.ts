import type { EnvironmentVariable } from '@yaakapp-internal/models';
import { useMemo } from 'react';
import { useActiveEnvironment } from './useActiveEnvironment';
import { useEnvironments } from './useEnvironments';

export function useActiveEnvironmentVariables() {
  const { baseEnvironment } = useEnvironments();
  const [environment] = useActiveEnvironment();

  const variables = useMemo(() => {
    const varMap: Record<string, EnvironmentVariable> = {};

    const allVariables = [...(baseEnvironment?.variables ?? []), ...(environment?.variables ?? [])];

    for (const v of allVariables) {
      if (!v.enabled || !v.name) continue;
      varMap[v.name] = v;
    }

    return Object.values(varMap);
  }, [baseEnvironment?.variables, environment?.variables]);

  return variables;
}
