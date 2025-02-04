import type { Workspace } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai';
import { jotaiStore } from '../lib/jotai';
import { invokeCmd } from '../lib/tauri';

export const workspacesAtom = atom<Workspace[]>(
  await invokeCmd<Workspace[]>('cmd_list_workspaces'),
);

export const sortedWorkspacesAtom = atom((get) =>
  get(workspacesAtom).sort((a, b) => a.name.localeCompare(b.name)),
);

export function useWorkspaces() {
  return useAtomValue(sortedWorkspacesAtom);
}

export function getWorkspace(id: string | null) {
  return jotaiStore.get(workspacesAtom).find((v) => v.id === id) ?? null;
}
