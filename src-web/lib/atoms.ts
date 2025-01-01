import deepEqual from '@gilbarbara/deep-equal';
import type { Atom } from 'jotai';
import { selectAtom } from 'jotai/utils';

export function deepEqualAtom<T>(a: Atom<T>) {
  return selectAtom(
    a,
    (v) => v,
    (a, b) => deepEqual(a, b),
  );
}
