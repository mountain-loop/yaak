import { atom } from 'jotai';
import { getKeyValue, setKeyValue } from '../keyValueStore';

export function atomWithKVStorage<T extends object | boolean | number | string | null>(
  key: string | string[],
  fallback: T,
  namespace = 'global',
) {
  const baseAtom = atom<T>(fallback);

  baseAtom.onMount = (setValue) => {
    setValue(getKeyValue<T>({ namespace, key, fallback }));
  };

  const derivedAtom = atom<T, [T | ((prev: T) => T)], void>(
    (get) => get(baseAtom),
    (get, set, update) => {
      const nextValue = typeof update === 'function' ? update(get(baseAtom)) : update;
      set(baseAtom, nextValue);
      setKeyValue({ namespace, key, value: nextValue }).catch(console.error);
    },
  );

  return derivedAtom;
}
