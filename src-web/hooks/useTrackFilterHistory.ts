import { useEffect } from 'react';
import { useKeyValue } from './useKeyValue';

/**
 * Track filter history keys associated with a request for cleanup purposes
 * Stores a registry of: requestId -> historyStateKeys[]
 */
export function useTrackFilterHistoryKeys(
  requestId: string | null,
  historyStateKey: string | null,
) {
  const { value: registry, set: setRegistry } = useKeyValue<Record<string, string[]>>({
    namespace: 'no_sync',
    key: 'filter_history_registry',
    fallback: {},
  });

  useEffect(() => {
    if (!requestId || !historyStateKey) return;

    const currentKeys = registry?.[requestId] ?? [];

    // Only update if this key isn't already tracked
    if (!currentKeys.includes(historyStateKey)) {
      setRegistry({
        ...registry,
        [requestId]: [...currentKeys, historyStateKey],
      });
    }
  }, [requestId, historyStateKey, registry, setRegistry]);
}

/**
 * Get all filter history keys for a request
 */
export async function getFilterHistoryKeysForRequest(requestId: string): Promise<string[]> {
  const { getKeyValue } = await import('../lib/keyValueStore');

  const registry = getKeyValue<Record<string, string[]>>({
    namespace: 'no_sync',
    key: 'filter_history_registry',
    fallback: {},
  });

  return registry[requestId] ?? [];
}

/**
 * Clean up filter history for deleted requests
 */
export async function cleanupFilterHistoryForRequest(requestId: string): Promise<void> {
  const { setKeyValue } = await import('../lib/keyValueStore');

  const historyKeys = await getFilterHistoryKeysForRequest(requestId);

  // Clear each history key
  for (const key of historyKeys) {
    try {
      await setKeyValue({
        namespace: 'no_sync',
        key: `input_history.${key}`,
        value: [],
      });
    } catch (error) {
      console.error(`Failed to cleanup history for key ${key}:`, error);
    }
  }

  // Remove from registry
  const registry = (await import('../lib/keyValueStore')).getKeyValue<Record<string, string[]>>({
    namespace: 'no_sync',
    key: 'filter_history_registry',
    fallback: {},
  });

  const updatedRegistry = { ...registry };
  delete updatedRegistry[requestId];

  await setKeyValue({
    namespace: 'no_sync',
    key: 'filter_history_registry',
    value: updatedRegistry,
  });
}
