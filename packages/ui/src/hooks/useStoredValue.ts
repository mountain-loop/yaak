import { atom, useAtom } from "jotai";
import { atomFamily } from "jotai-family";
import { useCallback, useState } from "react";

export type StoredValue = object | boolean | number | string | null;

export type SetStoredValue<T> = (value: T | ((prev: T) => T)) => void | Promise<unknown>;

/**
 * Reads and writes a value kept under `key`, falling back to `fallback` until one is written. A
 * `null` key keeps the value for the component's lifetime only. Components that remember things
 * take one of these, so each host decides where the memory lives.
 */
export type UseStoredValue = <T extends StoredValue>(
  key: string | string[] | null,
  fallback: T,
) => readonly [T, SetStoredValue<T>];

const memoryAtoms = atomFamily((_key: string) => atom<{ value: unknown } | null>(null));

/** The default {@link UseStoredValue}: kept in memory for the session */
export function useInMemoryStoredValue<T extends StoredValue>(
  key: string | string[] | null,
  fallback: T,
): readonly [T, SetStoredValue<T>] {
  const memoryKey = key == null ? null : Array.isArray(key) ? key.join("::") : key;
  const [local, setLocal] = useState<T>(fallback);
  const [stored, setStored] = useAtom(memoryAtoms(memoryKey ?? ""));

  const storedValue = stored == null ? fallback : (stored.value as T);
  const setStoredValue = useCallback<SetStoredValue<T>>(
    (update) =>
      setStored((prev) => {
        const prevValue = prev == null ? fallback : (prev.value as T);
        const value = typeof update === "function" ? (update as (p: T) => T)(prevValue) : update;
        return { value };
      }),
    [fallback, setStored],
  );

  return memoryKey == null ? [local, setLocal] : [storedValue, setStoredValue];
}
