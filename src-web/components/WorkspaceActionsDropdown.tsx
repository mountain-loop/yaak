import { revealItemInDir } from '@tauri-apps/plugin-opener';
import classNames from 'classnames';
import { memo, useCallback, useMemo } from 'react';
import { openWorkspaceFromSyncDir } from '../commands/openWorkspaceFromSyncDir';
import { openWorkspaceSettings } from '../commands/openWorkspaceSettings';
import { switchWorkspace } from '../commands/switchWorkspace';
import { useActiveWorkspace } from '../hooks/useActiveWorkspace';
import { useCreateWorkspace } from '../hooks/useCreateWorkspace';
import { useDeleteSendHistory } from '../hooks/useDeleteSendHistory';
import { settingsAtom } from '../hooks/useSettings';
import { useWorkspaceMeta } from '../hooks/useWorkspaceMeta';
import { getWorkspace, useWorkspaces } from '../hooks/useWorkspaces';
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
  const workspaces = useWorkspaces();
  const workspace = useActiveWorkspace();
  const createWorkspace = useCreateWorkspace();
  const workspaceMeta = useWorkspaceMeta();
  const { mutate: deleteSendHistory } = useDeleteSendHistory();

  const { workspaceItems, extraItems } = useMemo<{
    workspaceItems: RadioDropdownItem[];
    extraItems: DropdownItem[];
  }>(() => {
    const workspaceItems: RadioDropdownItem[] = workspaces.map((w) => ({
      key: w.id,
      label: w.name,
      value: w.id,
      leftSlot: w.id === workspace?.id ? <Icon icon="check" /> : <Icon icon="empty" />,
    }));

    const extraItems: DropdownItem[] = [
      {
        label: 'Workspace Settings',
        leftSlot: <Icon icon="settings" />,
        hotKeyAction: 'workspace_settings.show',
        onSelect: () => openWorkspaceSettings.mutate({}),
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
        onSelect: openWorkspaceFromSyncDir.mutate,
      },
    ];

    return { workspaceItems, extraItems };
  }, [workspaces, workspaceMeta, deleteSendHistory, createWorkspace, workspace?.id]);

  const handleChangeWorkspace = useCallback(async (workspaceId: string | null) => {
    if (workspaceId == null) return;

    const settings = jotaiStore.get(settingsAtom);
    if (typeof settings.openWorkspaceNewWindow === 'boolean') {
      switchWorkspace.mutate({ workspaceId, inNewWindow: settings.openWorkspaceNewWindow });
      return;
    }

    const workspace = getWorkspace(workspaceId);
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
      extraItems={extraItems}
      onChange={handleChangeWorkspace}
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
