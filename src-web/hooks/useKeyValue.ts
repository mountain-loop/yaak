import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { buildKeyValueKey, getKeyValue, setKeyValue } from '../lib/keyValueStore';

const DEFAULT_NAMESPACE = 'global';

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
  const query = useQuery<T>({
    queryKey: keyValueQueryKey({ namespace, key }),
    queryFn: async () => getKeyValue({ namespace, key, fallback }),
    refetchOnWindowFocus: false,
  });

  const mutate = useMutation<void, unknown, T>({
    mutationKey: ['set_key_value', namespace, key],
    mutationFn: (value) => setKeyValue<T>({ namespace, key, value }),
  });

  const set = useCallback(
    async (value: ((v: T) => T) | T) => {
      if (typeof value === 'function') {
        await getKeyValue({ namespace, key, fallback }).then((kv) => {
          const newV = value(kv);
          if (newV === kv) return;
          return mutate.mutateAsync(newV);
        });
      } else {
        // TODO: Make this only update if the value is different. I tried this but it seems query.data
        //  is stale.
        await mutate.mutateAsync(value);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [typeof key === 'string' ? key : key.join('::'), namespace],
  );

  const reset = useCallback(async () => mutate.mutateAsync(fallback), [mutate, fallback]);

  return useMemo(
    () => ({
      value: query.data,
      isLoading: query.isLoading,
      set,
      reset,
    }),
    [query.data, query.isLoading, reset, set],
  );
}
