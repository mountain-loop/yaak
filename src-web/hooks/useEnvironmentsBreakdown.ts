import { environmentsAtom } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai';

export const environmentsBreakdownAtom = atom((get) => {
  const allEnvironments = get(environmentsAtom);
  const baseEnvironments = allEnvironments.filter((e) => e.parentModel === 'workspace') ?? [];
  const subEnvironments = allEnvironments.filter((e) => e.parentModel === 'environment') ?? [];
  const folderEnvironments =
    allEnvironments.filter((e) => e.parentModel === 'folder' && e.parentId != null) ?? [];

  const baseEnvironment = baseEnvironments[0] ?? null;
  const otherBaseEnvironments = baseEnvironments.filter((e) => e.id !== baseEnvironment?.id) ?? [];
  return {
    allEnvironments,
    baseEnvironment,
    subEnvironments,
    folderEnvironments,
    otherBaseEnvironments,
    baseEnvironments,
  };
});

export function useEnvironmentsBreakdown() {
  return useAtomValue(environmentsBreakdownAtom);
}
