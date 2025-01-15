import type { Environment } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { atom } from 'jotai/index';

export const environmentsAtom = atom<Environment[]>([]);

export const sortedEnvironmentsAtom = atom((get) =>
  get(environmentsAtom).sort((a, b) => a.name.localeCompare(b.name)),
);

export const environmentsBreakdownAtom = atom<{
  baseEnvironment: Environment | null;
  allEnvironments: Environment[];
  subEnvironments: Environment[];
}>((get) => {
  const allEnvironments = get(sortedEnvironmentsAtom);
  const baseEnvironment = allEnvironments.find((e) => e.environmentId == null) ?? null;
  const subEnvironments =
    allEnvironments.filter((e) => e.environmentId === (baseEnvironment?.id ?? 'n/a')) ?? [];
  return { baseEnvironment, subEnvironments, allEnvironments } as const;
});

export function useEnvironments() {
  return useAtomValue(environmentsBreakdownAtom);
}
