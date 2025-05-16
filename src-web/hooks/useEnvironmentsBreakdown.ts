import { environmentsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { useMemo } from 'react';

export function useEnvironmentsBreakdown() {
  const allEnvironments = useAtomValue(environmentsAtom);
  return useMemo(() => {
    const baseEnvironments = allEnvironments.filter((e) => e.base) ?? [];
    const subEnvironments = allEnvironments.filter((e) => !e.base) ?? [];

    const baseEnvironment = baseEnvironments[0] ?? null;
    const otherBaseEnvironments =
      baseEnvironments.filter((e) => e.id !== baseEnvironment?.id) ?? [];
    return { allEnvironments, baseEnvironment, subEnvironments, otherBaseEnvironments };
  }, [allEnvironments]);
}
