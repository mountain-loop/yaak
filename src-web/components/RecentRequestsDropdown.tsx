import classNames from 'classnames';
import { useMemo, useRef } from 'react';
import { useKeyPressEvent } from 'react-use';
import { useActiveRequest } from '../hooks/useActiveRequest';
import { getActiveWorkspaceId } from '../hooks/useActiveWorkspace';
import { grpcRequestsAtom } from '../hooks/useGrpcRequests';
import { useHotKey } from '../hooks/useHotKey';
import { httpRequestsAtom } from '../hooks/useHttpRequests';
import { useRecentRequests } from '../hooks/useRecentRequests';
import { fallbackRequestName } from '../lib/fallbackRequestName';
import { jotaiStore } from '../lib/jotai';
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
  useKeyPressEvent('Control', undefined, () => {
    if (!dropdownRef.current?.isOpen) return;
    dropdownRef.current?.select?.();
  });

  useHotKey('request_switcher.prev', () => {
    if (!dropdownRef.current?.isOpen) {
      dropdownRef.current?.open();
      // Select the second because the first is the current request
      dropdownRef.current?.next?.(2);
    } else {
      dropdownRef.current?.next?.();
    }
  });

  useHotKey('request_switcher.next', () => {
    if (!dropdownRef.current?.isOpen) dropdownRef.current?.open();
    dropdownRef.current?.prev?.();
  });

  const items = useMemo(() => {
    const activeWorkspaceId = getActiveWorkspaceId();
    if (activeWorkspaceId === null) return [];

    const requests = [...jotaiStore.get(httpRequestsAtom), ...jotaiStore.get(grpcRequestsAtom)];
    const recentRequestItems: DropdownItem[] = [];
    for (const id of recentRequestIds) {
      const request = requests.find((r) => r.id === id);
      if (request === undefined) continue;

      recentRequestItems.push({
        key: request.id,
        label: fallbackRequestName(request),
        // leftSlot: <CountBadge className="!ml-0 px-0 w-5" count={recentRequestItems.length} />,
        leftSlot: <HttpMethodTag className="text-right" shortNames request={request} />,
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
        hotkeyAction="request_switcher.toggle"
        className={classNames(
          className,
          'truncate pointer-events-auto',
          activeRequest == null && 'text-text-subtlest italic',
        )}
      >
        {fallbackRequestName(activeRequest)}
      </Button>
    </Dropdown>
  );
}
