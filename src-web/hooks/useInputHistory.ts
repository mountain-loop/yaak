import { useAtomValue } from 'jotai';
import { useCallback, useMemo } from 'react';
import { HISTORY_LIMITS } from '../lib/historyConstants';
import { prepareHistoryInput } from '../lib/sanitizeInput';
import { showToast } from '../lib/toast';
import { activeWorkspaceAtom } from './useActiveWorkspace';
import { useKeyValue } from './useKeyValue';

export interface HistoryItem {
  value: string;
  timestamp: number;
  pinned?: boolean;
}

interface UseInputHistoryOptions {
  stateKey: string | null;
  maxItems?: number;
}

export function useInputHistory({ stateKey, maxItems }: UseInputHistoryOptions) {
  const workspace = useAtomValue(activeWorkspaceAtom);
  const defaultMaxItems = workspace?.settingMaxFilterHistory ?? HISTORY_LIMITS.DEFAULT_MAX_ITEMS;
  const effectiveMaxItems = maxItems ?? defaultMaxItems;

  const { value: history, set: setHistory } = useKeyValue<HistoryItem[]>({
    namespace: 'no_sync',
    key: stateKey ?? 'noop',
    fallback: [],
  });

  const addToHistory = useCallback(
    async (value: string) => {
      if (!stateKey) return;

      try {
        const sanitized = prepareHistoryInput(value);
        if (!sanitized) return;

        // Check if item already exists and is pinned - if so, skip silently
        const existingItem = (history ?? []).find((item) => item.value === sanitized);
        if (existingItem?.pinned) {
          return;
        }

        // Create new history item
        const newItem: HistoryItem = {
          value: sanitized,
          timestamp: Date.now(),
        };

        const filteredHistory = (history ?? []).filter((item) => item.value !== sanitized);
        
        // Separate pinned and unpinned items
        const pinnedItems = filteredHistory.filter((item) => item.pinned);
        const unpinnedItems = filteredHistory.filter((item) => !item.pinned);
        
        // Add new item to unpinned and apply limit only to unpinned items
        const limitedUnpinned = [newItem, ...unpinnedItems].slice(0, effectiveMaxItems);
        
        // Combine: pinned items always stay, unpinned items are limited
        const updated = [...pinnedItems, ...limitedUnpinned];

        await setHistory(updated);

        await setHistory(updated);
      } catch (error) {
        console.error('Failed to add to history:', error);
        showToast({
          message: 'Failed to save filter to history',
          color: 'danger',
        });
      }
    },
    [history, stateKey, effectiveMaxItems, setHistory],
  );

  const clearHistory = useCallback(async () => {
    if (!stateKey) return;

    try {
      await setHistory([]);
      showToast({
        message: 'Filter history cleared',
        color: 'success',
      });
    } catch (error) {
      console.error('Failed to clear history:', error);
      showToast({
        message: 'Failed to clear filter history',
        color: 'danger',
      });
    }
  }, [stateKey, setHistory, history]);

  const removeFromHistory = useCallback(
    async (value: string) => {
      if (!stateKey) return;

      try {
        const updated = (history ?? []).filter((item) => item.value !== value);

        await setHistory(updated);
      } catch (error) {
        console.error('Failed to remove from history:', error);
        showToast({
          message: 'Failed to remove from history',
          color: 'danger',
        });
      }
    },
    [history, stateKey, setHistory],
  );

  const togglePin = useCallback(
    async (value: string) => {
      if (!stateKey) return;

      try {
        const updated = (history ?? []).map((item) =>
          item.value === value ? { ...item, pinned: !item.pinned } : item,
        );

        await setHistory(updated);
        
        const item = updated.find((i) => i.value === value);
      } catch (error) {
        console.error('Failed to toggle pin:', error);
        showToast({
          message: 'Failed to toggle pin',
          color: 'danger',
        });
      }
    },
    [history, stateKey, setHistory],
  );

  const historyItems = useMemo(() => history ?? [], [history]);

  return {
    history: historyItems,
    addToHistory,
    clearHistory,
    removeFromHistory,
    togglePin,
  };
}
