import type { WritableAtom } from 'jotai';
import { useAtomValue, useStore } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { createContext, useCallback, useContext, useMemo } from 'react';

type CollapsedMap = Record<string, boolean>;
type SetAction = CollapsedMap | ((prev: CollapsedMap) => CollapsedMap);
export type CollapsedAtom = WritableAtom<CollapsedMap, [SetAction], void>;

export const CollapsedAtomContext = createContext<CollapsedAtom | null>(null);

export function useCollapsedAtom(): CollapsedAtom {
  const atom = useContext(CollapsedAtomContext);
  if (!atom) throw new Error('CollapsedAtomContext not provided');
  return atom;
}

export function useIsCollapsed(itemId: string | undefined) {
  const collapsedAtom = useCollapsedAtom();
  const derivedAtom = useMemo(
    () => selectAtom(collapsedAtom, (map) => !!map[itemId ?? 'n/a'], Object.is),
    [collapsedAtom, itemId],
  );
  return useAtomValue(derivedAtom);
}

export function useSetCollapsed(itemId: string | undefined) {
  const collapsedAtom = useCollapsedAtom();
  const store = useStore();
  return useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const key = itemId ?? 'n/a';
      const prevMap = store.get(collapsedAtom);
      const prevValue = !!prevMap[key];
      const value = typeof next === 'function' ? next(prevValue) : next;
      if (value === prevValue) return;
      store.set(collapsedAtom, { ...prevMap, [key]: value });
    },
    [collapsedAtom, itemId, store],
  );
}

export function useCollapsedMap() {
  const collapsedAtom = useCollapsedAtom();
  return useAtomValue(collapsedAtom);
}

export function useIsAncestorCollapsed(ancestorIds: string[]) {
  const collapsedAtom = useCollapsedAtom();
  const derivedAtom = useMemo(
    () =>
      selectAtom(
        collapsedAtom,
        (collapsed) => ancestorIds.some((id) => collapsed[id]),
        (a, b) => a === b,
      ),
    [collapsedAtom, ancestorIds],
  );
  return useAtomValue(derivedAtom);
}
