import { atom, useAtomValue } from 'jotai';
import { useCallback } from 'react';
import { atomWithKVStorage } from '../lib/atoms/atomWithKVStorage';
import { jotaiStore } from '../lib/jotai';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';

function kvKey(workspaceId: string | null) {
  return ['sidebar_collapsed', workspaceId ?? 'n/a'];
}

export const sidebarCollapsedAtom = atom((get) => {
  const workspaceId = get(activeWorkspaceIdAtom);
  return atomWithKVStorage<Record<string, boolean>>(kvKey(workspaceId), {});
});

export function useSidebarItemCollapsed(itemId: string) {
  const map = useAtomValue(useAtomValue(sidebarCollapsedAtom));
  const isCollapsed = map[itemId] === true;

  const toggle = useCallback(() => toggleSidebarItemCollapsed(itemId), [itemId]);

  return [isCollapsed, toggle] as const;
}

export function toggleSidebarItemCollapsed(itemId: string) {
  jotaiStore.set(jotaiStore.get(sidebarCollapsedAtom), (prev) => {
    return { ...prev, [itemId]: !prev[itemId] };
  });
}
