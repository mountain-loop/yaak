import type { EnvironmentVariable } from '@yaakapp-internal/models';
import { environmentsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { useActiveRequest } from './useActiveRequest';
import { useEnvironmentsBreakdown } from './useEnvironmentsBreakdown';
import { useParentFolders } from './useParentFolders';

export function useEnvironmentVariables(environmentId: string | null) {
  const { baseEnvironment, folderEnvironments } = useEnvironmentsBreakdown();
  const activeEnvironment =
    useAtomValue(environmentsAtom).find((e) => e.id === environmentId) ?? null;
  const activeRequest = useActiveRequest();
  const parentFolders = useParentFolders(activeRequest);

  return useMemo(() => {
    const varMap: Record<string, EnvironmentVariable> = {};
    const parentVariables = parentFolders.flatMap(
      (f) => folderEnvironments.find((fe) => fe.parentId === f.id)?.variables ?? [],
    );
    const allVariables = [
      ...(baseEnvironment?.variables ?? []),
      ...(activeEnvironment?.variables ?? []),
      ...parentVariables,
    ];

    for (const v of allVariables) {
      if (!v.enabled || !v.name) continue;
      varMap[v.name] = v;
    }

    return Object.values(varMap);
  }, [activeEnvironment?.variables, baseEnvironment?.variables, folderEnvironments, parentFolders]);
}
