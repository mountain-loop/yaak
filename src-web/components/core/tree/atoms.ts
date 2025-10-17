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
  return atom<{
    index: number | null;
    childIndex: number | null;
    parentId: string | null;
    parentDepth: number | null;
  }>({
    index: null,
    childIndex: null,
    parentId: null,
    parentDepth: null,
  });
});

export const isIndexHoveredFamily = atomFamily(
  ({ treeId, index }: { treeId: string; index: number}) =>
    selectAtom(hoveredParentFamily(treeId), (v) => v.index === index, Object.is),
  (a, b) => a.treeId === b.treeId && a.index === b.index,
);

export const hoveredParentDepthFamily = atomFamily((treeId: string) =>
  selectAtom(
    hoveredParentFamily(treeId),
    (s) => s.parentDepth,
    (a, b) => Object.is(a, b) // prevents re-render unless the value changes
  )
);

export const collapsedFamily = atomFamily((workspaceId: string) => {
  const key = ['sidebar_collapsed', workspaceId ?? 'n/a'];
  return atomWithKVStorage<Record<string, boolean>>(key, {});
});

export const isCollapsedFamily = atomFamily(
  ({ treeId, itemId = 'n/a' }: { treeId: string; itemId: string | undefined }) =>
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
