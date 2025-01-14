import { useCallback, useEffect, useState } from 'react';
import { jotaiStore } from '../lib/jotai';
import { setKeyValue } from '../lib/keyValueStore';
import { getActiveWorkspaceId } from './useActiveWorkspace';
import { getKeyValue, keyValuesAtom } from './useKeyValue';

function kvKey(workspaceId: string | null) {
  return ['sidebar_collapsed', workspaceId ?? 'n/a'];
}

export function useSidebarItemCollapsed(itemId: string) {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(
    getSidebarCollapsedMap()[itemId] === true,
  );
  useEffect(
    () =>
      jotaiStore.sub(keyValuesAtom, () => {
        setIsCollapsed(getSidebarCollapsedMap()[itemId] === true);
      }),
    [itemId],
  );

  const toggle = useCallback(() => {
    setKeyValue({
      key: kvKey(getActiveWorkspaceId()),
      namespace: 'no_sync',
      value: { ...getSidebarCollapsedMap(), [itemId]: !isCollapsed },
    }).catch(console.error);
  }, [isCollapsed, itemId]);

  return [isCollapsed, toggle] as const;
}

export function getSidebarCollapsedMap() {
  const activeWorkspaceId = getActiveWorkspaceId();
  if (activeWorkspaceId == null) return {};

  const value = getKeyValue<Record<string, boolean>>({
    key: kvKey(activeWorkspaceId),
    fallback: {},
    namespace: 'no_sync',
  });

  return value;
}
