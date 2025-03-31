import { environmentsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai/index';
import { useMemo } from 'react';

export function useEnvironmentsBreakdown() {
  const allEnvironments = useAtomValue(environmentsAtom);
  return useMemo(() => {
    const baseEnvironment = allEnvironments.find((e) => e.environmentId == null) ?? null;
    const subEnvironments =
      allEnvironments.filter((e) => e.environmentId === (baseEnvironment?.id ?? 'n/a')) ?? [];
    return { allEnvironments, baseEnvironment, subEnvironments };
  }, [allEnvironments]);
}
