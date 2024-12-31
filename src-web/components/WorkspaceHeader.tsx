import classNames from 'classnames';
import React, { memo } from 'react';
import { useActiveRequest } from '../hooks/useActiveRequest';
import { useToggleCommandPalette } from '../hooks/useToggleCommandPalette';
import { fallbackRequestName } from '../lib/fallbackRequestName';
import { CookieDropdown } from './CookieDropdown';
import { Icon } from './core/Icon';
import { IconButton } from './core/IconButton';
import { HStack } from './core/Stacks';
import { EnvironmentActionsDropdown } from './EnvironmentActionsDropdown';
import { ImportCurlButton } from './ImportCurlButton';
import { LicenseBadge } from './LicenseBadge';
import { RecentRequestsDropdown } from './RecentRequestsDropdown';
import { SettingsDropdown } from './SettingsDropdown';
import { SidebarActions } from './SidebarActions';
import { WorkspaceActionsDropdown } from './WorkspaceActionsDropdown';

interface Props {
  className?: string;
}

export const WorkspaceHeader = memo(function WorkspaceHeader({ className }: Props) {
  const togglePalette = useToggleCommandPalette();
  const activeRequest = useActiveRequest();

  return (
    <div
      className={classNames(
        className,
        'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center w-full h-full',
      )}
    >
      <HStack space={0.5} className="flex-1 pointer-events-none">
        <SidebarActions />
        <CookieDropdown />
        <HStack className="min-w-0">
          <WorkspaceActionsDropdown />
          <Icon icon="chevron_right" className="text-text-subtle" />
          <EnvironmentActionsDropdown className="w-auto pointer-events-auto" />
        </HStack>
      </HStack>
      <div className="pointer-events-none w-full max-w-[30vw] mx-auto flex justify-center">
        <RecentRequestsDropdown
          activeRequestId={activeRequest?.id ?? null}
          activeRequestName={fallbackRequestName(activeRequest)}
        />
      </div>
      <div className="flex-1 flex gap-1 items-center h-full justify-end pointer-events-none pr-1">
        <LicenseBadge />
        <ImportCurlButton />
        <IconButton
          icon="search"
          title="Search or execute a command"
          size="sm"
          event="search"
          onClick={togglePalette}
        />
        <SettingsDropdown />
      </div>
    </div>
  );
});
