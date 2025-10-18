import { atom } from 'jotai';
import { atomWithKVStorage } from '../lib/atoms/atomWithKVStorage';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';

function kvKey(workspaceId: string | null) {
  return ['sidebar_collapsed', workspaceId ?? 'n/a'];
}

export const sidebarCollapsedAtom = atom((get) => {
  const workspaceId = get(activeWorkspaceIdAtom);
  return atomWithKVStorage<Record<string, boolean>>(kvKey(workspaceId), {});
});
