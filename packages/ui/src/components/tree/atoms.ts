import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { selectAtom } from "jotai/utils";

/**
 * An atom family for object params, looked up by a string key. `atomFamily` with a comparator
 * scans every atom it has made on each lookup, which every rendered row does several times a
 * render, so a large tree slowed down in proportion to the rows it had ever shown.
 */
function keyedFamily<P, A>(key: (param: P) => string, create: (param: P) => A): (param: P) => A {
  const atoms = new Map<string, A>();
  return (param) => {
    const k = key(param);
    let a = atoms.get(k);
    if (a === undefined) {
      a = create(param);
      atoms.set(k, a);
    }
    return a;
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const selectedIdsFamily = atomFamily((_treeId: string) => {
  return atom<string[]>([]);
});

export const isSelectedFamily = keyedFamily(
  ({ treeId, itemId }: { treeId: string; itemId: string }) => `${treeId}\0${itemId}`,
  ({ treeId, itemId }) =>
    selectAtom(selectedIdsFamily(treeId), (ids) => ids.includes(itemId), Object.is),
);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const focusIdsFamily = atomFamily((_treeId: string) => {
  return atom<{ lastId: string | null; anchorId: string | null }>({ lastId: null, anchorId: null });
});

export const isLastFocusedFamily = keyedFamily(
  ({ treeId, itemId }: { treeId: string; itemId: string }) => `${treeId}\0${itemId}`,
  ({ treeId, itemId }) => selectAtom(focusIdsFamily(treeId), (v) => v.lastId === itemId, Object.is),
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

export const isParentHoveredFamily = keyedFamily(
  ({ treeId, parentId }: { treeId: string; parentId: string | null }) =>
    `${treeId}\0${parentId ?? ""}`,
  ({ treeId, parentId }) =>
    selectAtom(hoveredParentFamily(treeId), (v) => v.parentId === parentId, Object.is),
);

export const isAncestorHoveredFamily = keyedFamily(
  ({ treeId, ancestorIds }: { treeId: string; ancestorIds: string[] }) =>
    `${treeId}\0${ancestorIds.join(",")}`,
  ({ treeId, ancestorIds }) =>
    selectAtom(
      hoveredParentFamily(treeId),
      (v) => v.parentId && ancestorIds.includes(v.parentId),
      Object.is,
    ),
);

export const isIndexHoveredFamily = keyedFamily(
  ({ treeId, index }: { treeId: string; index: number }) => `${treeId}\0${index}`,
  ({ treeId, index }) =>
    selectAtom(hoveredParentFamily(treeId), (v) => v.index === index, Object.is),
);

export const hoveredParentDepthFamily = atomFamily((treeId: string) =>
  selectAtom(
    hoveredParentFamily(treeId),
    (s) => s.parentDepth,
    (a, b) => Object.is(a, b), // prevents re-render unless the value changes
  ),
);
