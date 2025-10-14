import { atom } from 'jotai';
import { atomFamily, selectAtom } from 'jotai/utils';
import { atomWithKVStorage } from '../../../lib/atoms/atomWithKVStorage';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const selectedIdsFamily = atomFamily((_treeId: string) => {
  return atom<string[]>([]);
});

export const isSelectedFamily = atomFamily(
  ({ treeId, itemId }: { treeId: string; itemId: string }) => {
    return selectAtom(selectedIdsFamily(treeId), (ids) => ids.includes(itemId), Object.is);
  },
  (a, b) => a.treeId === b.treeId && a.itemId === b.itemId,
);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const focusIdsFamily = atomFamily((_treeId: string) => {
  return atom<{ lastId: string | null; anchorId: string | null }>({ lastId: null, anchorId: null });
});

export const isLastFocusedFamily = atomFamily(
  ({ treeId, itemId }: { treeId: string; itemId: string }) =>
    selectAtom(focusIdsFamily(treeId), (v) => v.lastId == itemId, Object.is),
  (a, b) => a.treeId === b.treeId && a.itemId === b.itemId,
);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const draggingIdsFamily = atomFamily((_treeId: string) => {
  return atom<string[]>([]);
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const hoveredParentFamily = atomFamily((_treeId: string) => {
  return atom<{ index: number | null; parentId: string | null }>({ index: null, parentId: null });
});

export const isParentHoveredFamily = atomFamily(
  ({ treeId, parentId }: { treeId: string; parentId: string | null | undefined }) =>
    selectAtom(hoveredParentFamily(treeId), (v) => v.parentId === parentId, Object.is),
  (a, b) => a.treeId === b.treeId && a.parentId === b.parentId,
);

export const isItemHoveredFamily = atomFamily(
  ({
    treeId,
    parentId,
    index,
  }: {
    treeId: string;
    parentId: string | null | undefined;
    index: number | null;
  }) =>
    selectAtom(
      hoveredParentFamily(treeId),
      (v) => v.parentId === parentId && v.index === index,
      Object.is,
    ),
  (a, b) => a.treeId === b.treeId && a.parentId === b.parentId && a.index === b.index,
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
