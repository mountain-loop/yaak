import type { WorkspaceMeta } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai';

export const workspaceMetaAtom = atom<WorkspaceMeta | null>(null);

export function useWorkspaceMeta() {
  return useAtomValue(workspaceMetaAtom);
}
