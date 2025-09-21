import type { Environment, EnvironmentVariable } from '@yaakapp-internal/models';
import { foldersAtom } from '@yaakapp-internal/models';
import { useMemo } from 'react';
import { jotaiStore } from '../lib/jotai';
import { useActiveRequest } from './useActiveRequest';
import { useEnvironmentsBreakdown } from './useEnvironmentsBreakdown';
import { useParentFolders } from './useParentFolders';

export function useEnvironmentVariables(environmentId: string | null) {
  const { baseEnvironment, folderEnvironments, subEnvironments } = useEnvironmentsBreakdown();
  const activeEnvironment = subEnvironments.find((e) => e.id === environmentId) ?? null;
  const activeRequest = useActiveRequest();
  const parentFolders = useParentFolders(activeRequest);

  return useMemo(() => {
    const varMap: Record<string, WrappedEnvironmentVariable> = {};
    const folderVariables = parentFolders.flatMap((f) =>
      wrapVar(folderEnvironments.find((fe) => fe.parentId === f.id) ?? null),
    );

    const allVariables = [
      ...folderVariables,
      ...wrapVar(activeEnvironment),
      ...wrapVar(baseEnvironment),
    ];

    for (const v of allVariables) {
      if (!v.variable.enabled || !v.variable.name || varMap[v.variable.name] != null) {
        continue;
      }
      varMap[v.variable.name] = v;
    }

    return Object.values(varMap);
  }, [activeEnvironment, baseEnvironment, folderEnvironments, parentFolders]);
}

export interface WrappedEnvironmentVariable {
  variable: EnvironmentVariable;
  environment: Environment;
  source: string;
}

const wrapVar = (e: Environment | null): WrappedEnvironmentVariable[] => {
  if (e == null) return [];
  const folders = jotaiStore.get(foldersAtom);
  return e.variables.map((v) => {
    const folder = e.parentModel === 'folder' ? folders.find((f) => f.id === e.parentId) : null;
    const source = folder?.name ?? e.name;
    return { variable: v, environment: e, source };
  });
};
