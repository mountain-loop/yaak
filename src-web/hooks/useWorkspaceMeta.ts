import type { WorkspaceMeta } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai';
import { jotaiStore } from '../lib/jotai';

export const workspaceMetaAtom = atom<WorkspaceMeta | null>(null);

export function useWorkspaceMeta() {
  return useAtomValue(workspaceMetaAtom);
}

export function getWorkspaceMeta() {
  return jotaiStore.get(workspaceMetaAtom);
}
