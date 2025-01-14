import type { EnvironmentVariable } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai';
import { activeEnvironmentAtom } from './useActiveEnvironment';
import { environmentsBreakdownAtom } from './useEnvironments';

const activeEnvironmentVariablesAtom = atom((get) => {
  const { baseEnvironment } = get(environmentsBreakdownAtom);
  const activeEnvironment = get(activeEnvironmentAtom);

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
});

export function useActiveEnvironmentVariables() {
  return useAtomValue(activeEnvironmentVariablesAtom);
}
