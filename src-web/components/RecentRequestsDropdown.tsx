import classNames from 'classnames';
import { useMemo, useRef } from 'react';
import { useKeyPressEvent } from 'react-use';
import { useActiveCookieJar } from '../hooks/useActiveCookieJar';
import { useActiveEnvironment } from '../hooks/useActiveEnvironment';
import { useActiveRequest } from '../hooks/useActiveRequest';
import { useActiveWorkspace } from '../hooks/useActiveWorkspace';
import { useAppRoutes } from '../hooks/useAppRoutes';
import { useHotKey } from '../hooks/useHotKey';
import { useRecentRequests } from '../hooks/useRecentRequests';
import { useRequests } from '../hooks/useRequests';
import { fallbackRequestName } from '../lib/fallbackRequestName';
import type { ButtonProps } from './core/Button';
import { Button } from './core/Button';
import type { DropdownItem, DropdownRef } from './core/Dropdown';
import { Dropdown } from './core/Dropdown';
import { HttpMethodTag } from './core/HttpMethodTag';

export function RecentRequestsDropdown({ className }: Pick<ButtonProps, 'className'>) {
  const dropdownRef = useRef<DropdownRef>(null);
  const activeRequest = useActiveRequest();
  const activeWorkspace = useActiveWorkspace();
  const [activeEnvironment] = useActiveEnvironment();
  const [activeCookieJar] = useActiveCookieJar();
  const routes = useAppRoutes();
  const allRecentRequestIds = useRecentRequests();
  const requests = useRequests();

  // Handle key-up
  useKeyPressEvent('Control', undefined, () => {
    if (!dropdownRef.current?.isOpen) return;
    dropdownRef.current?.select?.();
  });

  useHotKey('request_switcher.prev', () => {
    if (!dropdownRef.current?.isOpen) dropdownRef.current?.open();
    dropdownRef.current?.next?.();
  });

  useHotKey('request_switcher.next', () => {
    if (!dropdownRef.current?.isOpen) dropdownRef.current?.open();
    dropdownRef.current?.prev?.();
  });

  const { items, hasRecentRequests } = useMemo(() => {
    if (activeWorkspace === null) return { items: [], hasRecentRequests: false };

    const recentRequestItems: DropdownItem[] = [];

    for (const id of allRecentRequestIds) {
      const request = requests.find((r) => r.id === id);
      if (!request) continue;

      recentRequestItems.push({
        key: request.id,
        label: fallbackRequestName(request),
        // leftSlot: <CountBadge className="!ml-0 px-0 w-5" count={recentRequestItems.length} />,
        leftSlot: <HttpMethodTag className="text-right" shortNames request={request} />,
        onSelect: () => {
          routes.navigate('request', {
            requestId: request.id,
            workspaceId: activeWorkspace.id,
            environmentId: activeEnvironment?.id ?? null,
            cookieJarId: activeCookieJar?.id ?? null,
          });
        },
      });
    }

    // No recent requests to show
    if (recentRequestItems.length === 0) {
      return {
        items: [
          {
            key: 'no-recent-requests',
            label: 'No recent requests',
            disabled: true,
          },
        ],
        hasRecentRequests: false,
      };
    }

    return { items: recentRequestItems.slice(0, 20), hasRecentRequests: true };
  }, [activeWorkspace, allRecentRequestIds, requests, routes, activeEnvironment?.id, activeCookieJar?.id]);

  return hasRecentRequests ? (
    <Dropdown ref={dropdownRef} items={items}>
      <Button
        data-tauri-drag-region
        size="sm"
        hotkeyAction="request_switcher.toggle"
        className={classNames(
          className,
          'truncate pointer-events-auto',
          activeRequest === null && 'text-text-subtlest italic',
        )}
      >
        {fallbackRequestName(activeRequest)}
      </Button>
    </Dropdown>
  ) : null;
}
