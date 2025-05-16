import type { EnvironmentVariable } from '@yaakapp-internal/models';
import { environmentsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { useEnvironmentsBreakdown } from './useEnvironmentsBreakdown';

export function useEnvironmentVariables(environmentId: string | null) {
  const { baseEnvironment } = useEnvironmentsBreakdown();
  const activeEnvironment =
    useAtomValue(environmentsAtom).find((e) => e.id === environmentId) ?? null;
  return useMemo(() => {
    const varMap: Record<string, EnvironmentVariable> = {};
    const allVariables = [
      ...(baseEnvironment?.variables ?? []),
      ...(activeEnvironment?.variables ?? []),
    ];

    for (const v of allVariables) {
      if (!v.enabled || !v.name) continue;
      varMap[v.name] = v;
    }

    return Object.values(varMap);
  }, [activeEnvironment, baseEnvironment]);
}
