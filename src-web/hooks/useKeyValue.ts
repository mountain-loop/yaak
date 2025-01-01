import { useMutation } from '@tanstack/react-query';
import type { KeyValue } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { atom } from 'jotai/index';
import { useCallback, useMemo } from 'react';
import { jotaiStore } from '../lib/jotai';
import { buildKeyValueKey, extractKeyValueOrFallback, setKeyValue } from '../lib/keyValueStore';

const DEFAULT_NAMESPACE = 'global';

export const keyValuesAtom = atom<KeyValue[]>([]);

export function keyValueQueryKey({
  namespace = DEFAULT_NAMESPACE,
  key,
}: {
  namespace?: string;
  key: string | string[];
}) {
  return ['key_value', { namespace, key: buildKeyValueKey(key) }];
}

export function useKeyValue<T extends object | boolean | number | string | null>({
  namespace = DEFAULT_NAMESPACE,
  key,
  fallback,
}: {
  namespace?: 'global' | 'no_sync' | 'license';
  key: string | string[];
  fallback: T;
}) {
  const keyValues = useAtomValue(keyValuesAtom);
  const keyValue =
    keyValues?.find((kv) => buildKeyValueKey(kv.key) === buildKeyValueKey(key)) ?? null;
  const value = extractKeyValueOrFallback(keyValue, fallback);
  const isLoading = keyValues == null;

  const { mutateAsync } = useMutation<void, unknown, T>({
    mutationKey: ['set_key_value', namespace, key],
    mutationFn: (value) => setKeyValue<T>({ namespace, key, value }),
  });

  const set = useCallback(
    async (valueOrUpdate: ((v: T) => T) | T) => {
      if (typeof valueOrUpdate === 'function') {
        const newV = valueOrUpdate(value);
        if (newV === value) return;
        await mutateAsync(newV);
      } else {
        // TODO: Make this only update if the value is different. I tried this but it seems query.data
        //  is stale.
        await mutateAsync(valueOrUpdate);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [typeof key === 'string' ? key : key.join('::'), namespace, value],
  );

  const reset = useCallback(async () => mutateAsync(fallback), [fallback, mutateAsync]);

  return useMemo(
    () => ({
      value,
      isLoading,
      set,
      reset,
    }),
    [isLoading, reset, set, value],
  );
}

export function getKeyValue<T extends object | boolean | number | string | null>({
  namespace,
  key,
  fallback,
}: {
  namespace?: 'global' | 'no_sync' | 'license';
  key: string | string[];
  fallback: T;
}) {
  const keyValues = jotaiStore.get(keyValuesAtom);
  const keyValue =
    keyValues?.find(
      (kv) => kv.namespace === namespace && buildKeyValueKey(kv.key) === buildKeyValueKey(key),
    ) ?? null;
  const value = extractKeyValueOrFallback(keyValue, fallback);
  return value;
}
