import type { Environment } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { atom } from 'jotai/index';

export const environmentsAtom = atom<Environment[]>([]);

export function useEnvironments() {
  const allEnvironments = useAtomValue(environmentsAtom);
  const baseEnvironment = allEnvironments.find((e) => e.environmentId == null) ?? null;
  const subEnvironments =
    allEnvironments.filter((e) => e.environmentId === (baseEnvironment?.id ?? 'n/a')) ?? [];

  return { baseEnvironment, subEnvironments, allEnvironments } as const;
}
