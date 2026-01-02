import { keyValuesAtom } from '@yaakapp-internal/models';
import { jotaiStore } from './jotai';
import { buildKeyValueKey, setKeyValue } from './keyValueStore';

/**
 * Clean up history entries for a deleted request/resource
 */
export async function cleanupHistoryForKey(stateKey: string): Promise<void> {
  const historyKey = `input_history.filter.${stateKey}`;

  try {
    await setKeyValue({
      namespace: 'no_sync',
      key: historyKey,
      value: [],
    });
  } catch (error) {
    console.error('Failed to cleanup history:', error);
  }
}

/**
 * Copy history from one request to another (for duplication)
 */
export async function copyHistoryForKey(fromStateKey: string, toStateKey: string): Promise<void> {
  const fromKey = `input_history.filter.${fromStateKey}`;
  const toKey = `input_history.filter.${toStateKey}`;

  try {
    const keyValues = jotaiStore.get(keyValuesAtom);
    const fromKeyValue = keyValues?.find(
      (kv) => buildKeyValueKey(kv.key) === buildKeyValueKey(fromKey),
    );

    if (fromKeyValue?.value) {
      const history = JSON.parse(fromKeyValue.value);
      await setKeyValue({
        namespace: 'no_sync',
        key: toKey,
        value: history,
      });
    }
  } catch (error) {
    console.error('Failed to copy history:', error);
  }
}

/**
 * Get all history keys for cleanup purposes
 */
export function getAllHistoryKeys(): string[] {
  const keyValues = jotaiStore.get(keyValuesAtom);
  if (!keyValues) return [];

  return keyValues.filter((kv) => kv.key.startsWith('input_history.')).map((kv) => kv.key);
}
