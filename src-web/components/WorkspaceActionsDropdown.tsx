import { open } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { getModel, settingsAtom, workspacesAtom } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { memo, useCallback, useMemo } from 'react';
import { openWorkspaceFromSyncDir } from '../commands/openWorkspaceFromSyncDir';
import { openWorkspaceSettings } from '../commands/openWorkspaceSettings';
import { switchWorkspace } from '../commands/switchWorkspace';
import {
  activeWorkspaceAtom,
  activeWorkspaceIdAtom,
  activeWorkspaceMetaAtom,
} from '../hooks/useActiveWorkspace';
import { useCreateWorkspace } from '../hooks/useCreateWorkspace';
import { useDeleteSendHistory } from '../hooks/useDeleteSendHistory';
import { showDialog } from '../lib/dialog';
import { jotaiStore } from '../lib/jotai';
import { revealInFinderText } from '../lib/reveal';
import type { ButtonProps } from './core/Button';
import { Button } from './core/Button';
import type { DropdownItem } from './core/Dropdown';
import { Icon } from './core/Icon';
import type { RadioDropdownItem } from './core/RadioDropdown';
import { RadioDropdown } from './core/RadioDropdown';
import { SwitchWorkspaceDialog } from './SwitchWorkspaceDialog';

type Props = Pick<ButtonProps, 'className' | 'justify' | 'forDropdown' | 'leftSlot'>;

export const WorkspaceActionsDropdown = memo(function WorkspaceActionsDropdown({
  className,
  ...buttonProps
}: Props) {
  const workspaces = useAtomValue(workspacesAtom);
  const workspace = useAtomValue(activeWorkspaceAtom);
  const createWorkspace = useCreateWorkspace();
  const workspaceMeta = useAtomValue(activeWorkspaceMetaAtom);
  const { mutate: deleteSendHistory } = useDeleteSendHistory();

  const { workspaceItems, itemsAfter } = useMemo<{
    workspaceItems: RadioDropdownItem[];
    itemsAfter: DropdownItem[];
  }>(() => {
    const workspaceItems: RadioDropdownItem[] = workspaces.map((w) => ({
      key: w.id,
      label: w.name,
      value: w.id,
      leftSlot: w.id === workspace?.id ? <Icon icon="check" /> : <Icon icon="empty" />,
    }));

    const itemsAfter: DropdownItem[] = [
      {
        label: 'Workspace Settings',
        leftSlot: <Icon icon="settings" />,
        hotKeyAction: 'workspace_settings.show',
        onSelect: openWorkspaceSettings,
      },
      {
        label: revealInFinderText,
        hidden: workspaceMeta == null || workspaceMeta.settingSyncDir == null,
        leftSlot: <Icon icon="folder_symlink" />,
        onSelect: async () => {
          if (workspaceMeta?.settingSyncDir == null) return;
          await revealItemInDir(workspaceMeta.settingSyncDir);
        },
      },
      {
        label: 'Clear Send History',
        color: 'warning',
        leftSlot: <Icon icon="history" />,
        onSelect: deleteSendHistory,
      },
      { type: 'separator' },
      {
        label: 'New Workspace',
        leftSlot: <Icon icon="plus" />,
        onSelect: createWorkspace,
      },
      {
        label: 'Open Existing Workspace',
        leftSlot: <Icon icon="folder_open" />,
        onSelect: async () => {
          const dir = await open({
            title: 'Select Workspace Directory',
            directory: true,
            multiple: false,
          });

          if (dir == null) return;
          openWorkspaceFromSyncDir.mutate(dir);
        },
      },
    ];

    return { workspaceItems, itemsAfter };
  }, [workspaces, workspaceMeta, deleteSendHistory, createWorkspace, workspace?.id]);

  const handleSwitchWorkspace = useCallback(async (workspaceId: string | null) => {
    if (workspaceId == null) return;

    const settings = jotaiStore.get(settingsAtom);
    const activeWorkspaceId = jotaiStore.get(activeWorkspaceIdAtom);
    if (workspaceId === activeWorkspaceId) {
      // Always open a new window if the selected one is already active
      switchWorkspace.mutate({ workspaceId, inNewWindow: true });
      return;
    } else if (typeof settings.openWorkspaceNewWindow === 'boolean') {
      switchWorkspace.mutate({ workspaceId, inNewWindow: settings.openWorkspaceNewWindow });
      return;
    }

    const workspace = getModel('workspace', workspaceId);
    if (workspace == null) return;

    showDialog({
      id: 'switch-workspace',
      size: 'sm',
      title: 'Switch Workspace',
      render: ({ hide }) => <SwitchWorkspaceDialog workspace={workspace} hide={hide} />,
    });
  }, []);

  return (
    <RadioDropdown
      items={workspaceItems}
      itemsAfter={itemsAfter}
      onChange={handleSwitchWorkspace}
      value={workspace?.id ?? null}
    >
      <Button
        size="sm"
        className={classNames(
          className,
          'text !px-2 truncate',
          workspace === null && 'italic opacity-disabled',
        )}
        {...buttonProps}
      >
        {workspace?.name ?? 'Workspace'}
      </Button>
    </RadioDropdown>
  );
});
