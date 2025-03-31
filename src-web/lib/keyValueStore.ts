import type { KeyValue } from '@yaakapp-internal/models';
import { createGlobalModel, keyValuesAtom, patchModel } from '@yaakapp-internal/models';
import { jotaiStore } from './jotai';

export async function setKeyValue<T>({
  namespace = 'global',
  key: keyOrKeys,
  value: rawValue,
}: {
  namespace?: string;
  key: string | string[];
  value: T;
}): Promise<void> {
  const kv = getKeyValueRaw({ namespace, key: keyOrKeys });
  const key = buildKeyValueKey(keyOrKeys);
  const value = JSON.stringify(rawValue);

  if (kv) {
    await patchModel(kv, { namespace, key, value });
  } else {
    await createGlobalModel({ model: 'key_value', namespace, key, value });
  }
}

export function getKeyValueRaw({
  namespace = 'global',
  key: keyOrKeys,
}: {
  namespace?: string;
  key: string | string[];
}) {
  const key = buildKeyValueKey(keyOrKeys);
  const kv = jotaiStore
    .get(keyValuesAtom)
    .find((kv) => kv.namespace === namespace && kv?.key === key);
  return kv ?? null;
}

export function getKeyValue<T>({
  namespace = 'global',
  key,
  fallback,
}: {
  namespace?: string;
  key: string | string[];
  fallback: T;
}) {
  const kv = getKeyValueRaw({ namespace, key });
  return extractKeyValueOrFallback(kv, fallback);
}

export function extractKeyValue<T>(kv: KeyValue | null): T | undefined {
  if (kv === null) return undefined;
  try {
    return JSON.parse(kv.value) as T;
  } catch (err) {
    console.log('Failed to parse kv value', kv.value, err);
    return undefined;
  }
}

export function extractKeyValueOrFallback<T>(kv: KeyValue | null, fallback: T): T {
  const v = extractKeyValue<T>(kv);
  if (v === undefined) return fallback;
  return v;
}

export function buildKeyValueKey(key: string | string[]): string {
  if (typeof key === 'string') return key;
  return key.join('::');
}
