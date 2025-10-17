import { type } from '@tauri-apps/plugin-os';
import classNames from 'classnames';
import { useAtom, useAtomValue } from 'jotai';
import React, { memo } from 'react';
import { activeWorkspaceAtom, activeWorkspaceMetaAtom } from '../hooks/useActiveWorkspace';
import { useToggleCommandPalette } from '../hooks/useToggleCommandPalette';
import { workspaceLayoutAtom } from '../lib/atoms';
import { setupOrConfigureEncryption } from '../lib/setupOrConfigureEncryption';
import { CookieDropdown } from './CookieDropdown';
import { BadgeButton } from './core/BadgeButton';
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
  const [workspaceLayout, setWorkspaceLayout] = useAtom(workspaceLayoutAtom);
  const workspace = useAtomValue(activeWorkspaceAtom);
  const workspaceMeta = useAtomValue(activeWorkspaceMetaAtom);
  const showEncryptionSetup =
    workspace?.encryptionKeyChallenge != null && workspaceMeta?.encryptionKey == null;

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
          <Icon icon="chevron_right" color="secondary" />
          <EnvironmentActionsDropdown className="w-auto pointer-events-auto" />
        </HStack>
      </HStack>
      <div className="pointer-events-none w-full max-w-[30vw] mx-auto flex justify-center">
        <RecentRequestsDropdown />
      </div>
      <div className="flex-1 flex gap-1 items-center h-full justify-end pointer-events-none pr-1">
        <ImportCurlButton />
        {showEncryptionSetup ? (
          <BadgeButton color="danger" onClick={setupOrConfigureEncryption}>
            Enter Encryption Key
          </BadgeButton>
        ) : (
          <LicenseBadge />
        )}
        <IconButton
          icon={
            workspaceLayout === 'responsive'
              ? 'magic_wand'
              : workspaceLayout === 'horizontal'
                ? 'columns_2'
                : 'rows_2'
          }
          title={`Change to ${workspaceLayout === 'horizontal' ? 'vertical' : 'horizontal'} layout`}
          size="sm"
          iconColor="secondary"
          onClick={() =>
            setWorkspaceLayout((prev) => (prev === 'horizontal' ? 'vertical' : 'horizontal'))
          }
        />
        <IconButton
          icon={type() == 'macos' ? 'command' : 'square_terminal'}
          title="Search or execute a command"
          size="sm"
          iconColor="secondary"
          onClick={togglePalette}
        />
        <SettingsDropdown />
      </div>
    </div>
  );
});
