import { keyValuesAtom } from '@yaakapp-internal/models';
import { useCallback, useEffect, useState } from 'react';
import { jotaiStore } from '../lib/jotai';
import { setKeyValue } from '../lib/keyValueStore';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';
import { getKeyValue } from './useKeyValue';

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
      key: kvKey(jotaiStore.get(activeWorkspaceIdAtom)),
      namespace: 'no_sync',
      value: { ...getSidebarCollapsedMap(), [itemId]: !isCollapsed },
    }).catch(console.error);
  }, [isCollapsed, itemId]);

  return [isCollapsed, toggle] as const;
}

export function getSidebarCollapsedMap() {
  const value = getKeyValue<Record<string, boolean>>({
    key: kvKey(jotaiStore.get(activeWorkspaceIdAtom)),
    fallback: {},
    namespace: 'no_sync',
  });

  return value;
}
