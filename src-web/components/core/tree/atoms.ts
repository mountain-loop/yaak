import { atom } from 'jotai';
import { atomFamily, selectAtom } from 'jotai/utils';
import { atomWithKVStorage } from '../../../lib/atoms/atomWithKVStorage';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const selectedIdsFamily = atomFamily((_: string) => {
  return atom<string[]>([]);
});

export const isSelectedFamily = atomFamily(
  ({ treeId, itemId }: { treeId: string; itemId: string }) =>
    selectAtom(selectedIdsFamily(treeId), (ids) => ids.includes(itemId), Object.is),
  (a, b) => a.treeId === b.treeId && a.itemId === b.itemId,
);

function kvKey(workspaceId: string | null) {
  return ['sidebar_collapsed', workspaceId ?? 'n/a'];
}

export const collapsedFamily = atomFamily((workspaceId: string) => {
  return atomWithKVStorage<Record<string, boolean>>(kvKey(workspaceId), {});
});

export const isCollapsedFamily = atomFamily(
  ({ treeId, itemId }: { treeId: string; itemId: string }) =>
    atom(
      // --- getter ---
      (get) => !!get(collapsedFamily(treeId))[itemId],

      // --- setter ---
      (get, set, next: boolean | ((prev: boolean) => boolean)) => {
        const a = collapsedFamily(treeId);
        const prevMap = get(a);
        const prevValue = !!prevMap[itemId];
        const value = typeof next === 'function' ? next(prevValue) : next;

        if (value === prevValue) return; // no-op

        set(a, { ...prevMap, [itemId]: value });
      },
    ),
  (a, b) => a.treeId === b.treeId && a.itemId === b.itemId,
);
