import type { Environment, EnvironmentVariable } from '@yaakapp-internal/models';
import { foldersAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { jotaiStore } from '../lib/jotai';
import { isBaseEnvironment, isFolderEnvironment } from '../lib/model_util';
import { useActiveEnvironment } from './useActiveEnvironment';
import { useActiveRequest } from './useActiveRequest';
import { useEnvironmentsBreakdown } from './useEnvironmentsBreakdown';
import { useParentFolders } from './useParentFolders';

export function useEnvironmentVariables(targetEnvironmentId: string | null) {
  const { baseEnvironment, folderEnvironments, allEnvironments } = useEnvironmentsBreakdown();
  const activeEnvironment = useActiveEnvironment();
  const targetEnvironment = allEnvironments.find((e) => e.id === targetEnvironmentId) ?? null;
  const activeRequest = useActiveRequest();
  const folders = useAtomValue(foldersAtom);
  const activeFolder = folders.find((f) => f.id === targetEnvironment?.parentId) ?? null;
  const parentFolders = useParentFolders(activeFolder ?? activeRequest);

  return useMemo(() => {
    const varMap: Record<string, WrappedEnvironmentVariable> = {};
    const folderVariables = parentFolders.flatMap((f) =>
      wrapVariables(folderEnvironments.find((fe) => fe.parentId === f.id) ?? null),
    );

    // Add active environment variables to everything except sub environments
    const activeEnvironmentVariables =
      targetEnvironment == null || // Editing request
      isFolderEnvironment(targetEnvironment) || // Editing folder variables
      isBaseEnvironment(targetEnvironment) // Editing global variables
        ? wrapVariables(activeEnvironment)
        : wrapVariables(targetEnvironment); // Add own variables for sub environments

    const allVariables = [
      ...folderVariables,
      ...activeEnvironmentVariables,
      ...wrapVariables(baseEnvironment),
    ];

    for (const v of allVariables) {
      if (!v.variable.enabled || !v.variable.name || v.variable.name in varMap) {
        continue;
      }
      varMap[v.variable.name] = v;
    }

    return Object.values(varMap);
  }, [activeEnvironment, baseEnvironment, folderEnvironments, parentFolders, targetEnvironment]);
}

export interface WrappedEnvironmentVariable {
  variable: EnvironmentVariable;
  environment: Environment;
  source: string;
}

function wrapVariables(e: Environment | null): WrappedEnvironmentVariable[] {
  if (e == null) return [];
  const folders = jotaiStore.get(foldersAtom);
  return e.variables.map((v) => {
    const folder = e.parentModel === 'folder' ? folders.find((f) => f.id === e.parentId) : null;
    const source = folder?.name ?? e.name;
    return { variable: v, environment: e, source };
  });
}
