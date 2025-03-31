import { useModelList } from '@yaakapp-internal/models';
import { useMemo } from 'react';

export function useEnvironmentsBreakdown() {
  const allEnvironments = useModelList('environment');
  return useMemo(() => {
    const baseEnvironment = allEnvironments.find((e) => e.environmentId == null) ?? null;
    const subEnvironments =
      allEnvironments.filter((e) => e.environmentId === (baseEnvironment?.id ?? 'n/a')) ?? [];
    return { allEnvironments, baseEnvironment, subEnvironments };
  }, [allEnvironments]);
}
