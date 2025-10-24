import classNames from 'classnames';
import { useMemo, useRef } from 'react';
import { useActiveRequest } from '../hooks/useActiveRequest';
import { activeWorkspaceIdAtom } from '../hooks/useActiveWorkspace';
import { useHotKey } from '../hooks/useHotKey';
import { useKeyboardEvent } from '../hooks/useKeyboardEvent';
import { useRecentRequests } from '../hooks/useRecentRequests';
import { allRequestsAtom } from '../hooks/useAllRequests';
import { jotaiStore } from '../lib/jotai';
import { resolvedModelName } from '../lib/resolvedModelName';
import { router } from '../lib/router';
import { Button } from './core/Button';
import type { DropdownItem, DropdownRef } from './core/Dropdown';
import { Dropdown } from './core/Dropdown';
import { HttpMethodTag } from './core/HttpMethodTag';

interface Props {
  className?: string;
}

export function RecentRequestsDropdown({ className }: Props) {
  const activeRequest = useActiveRequest();
  const dropdownRef = useRef<DropdownRef>(null);
  const [recentRequestIds] = useRecentRequests();

  // Handle key-up
  // TODO: Somehow make useHotKey have this functionality. Note: e.key does not work
  //  on Linux, for example, when Control is mapped to CAPS. This will never fire.
  useKeyboardEvent('keyup', 'Control', () => {
    if (dropdownRef.current?.isOpen) {
      dropdownRef.current?.select?.();
    }
  });

  useHotKey('switcher.prev', () => {
    if (!dropdownRef.current?.isOpen) {
      // Select the second because the first is the current request
      dropdownRef.current?.open(1);
    } else {
      dropdownRef.current?.next?.();
    }
  });

  useHotKey('switcher.next', () => {
    if (!dropdownRef.current?.isOpen) dropdownRef.current?.open();
    dropdownRef.current?.prev?.();
  });

  const items = useMemo(() => {
    const activeWorkspaceId = jotaiStore.get(activeWorkspaceIdAtom);
    if (activeWorkspaceId === null) return [];

    const requests = jotaiStore.get(allRequestsAtom);
    const recentRequestItems: DropdownItem[] = [];
    for (const id of recentRequestIds) {
      const request = requests.find((r) => r.id === id);
      if (request === undefined) continue;

      recentRequestItems.push({
        label: resolvedModelName(request),
        leftSlot: <HttpMethodTag short className="text-xs" request={request} />,
        onSelect: async () => {
          await router.navigate({
            to: '/workspaces/$workspaceId',
            params: { workspaceId: activeWorkspaceId },
            search: (prev) => ({ ...prev, request_id: request.id }),
          });
        },
      });
    }

    // No recent requests to show
    if (recentRequestItems.length === 0) {
      return [
        {
          key: 'no-recent-requests',
          label: 'No recent requests',
          disabled: true,
        },
      ];
    }

    return recentRequestItems.slice(0, 20);
  }, [recentRequestIds]);

  return (
    <Dropdown ref={dropdownRef} items={items}>
      <Button
        size="sm"
        hotkeyAction="switcher.toggle"
        className={classNames(
          className,
          'truncate pointer-events-auto',
          activeRequest == null && 'text-text-subtlest italic',
        )}
      >
        {resolvedModelName(activeRequest)}
      </Button>
    </Dropdown>
  );
}
