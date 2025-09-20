import { environmentsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { useMemo } from 'react';

export function useEnvironmentsBreakdown() {
  const allEnvironments = useAtomValue(environmentsAtom);
  return useMemo(() => {
    const baseEnvironments = allEnvironments.filter((e) => e.parentId == null) ?? [];
    const subEnvironments =
      allEnvironments.filter((e) => e.parentModel === 'environment' && e.parentId != null) ?? [];
    const folderEnvironments =
      allEnvironments.filter((e) => e.parentModel === 'folder' && e.parentId != null) ?? [];

    const baseEnvironment = baseEnvironments[0] ?? null;
    const otherBaseEnvironments =
      baseEnvironments.filter((e) => e.id !== baseEnvironment?.id) ?? [];
    return { allEnvironments, baseEnvironment, subEnvironments, folderEnvironments, otherBaseEnvironments };
  }, [allEnvironments]);
}
