import classNames from 'classnames';
import { memo, useCallback, useMemo } from 'react';
import { useActiveWorkspace } from '../hooks/useActiveWorkspace';
import { useCreateWorkspace } from '../hooks/useCreateWorkspace';
import { useDeleteSendHistory } from '../hooks/useDeleteSendHistory';
import { useDeleteWorkspace } from '../hooks/useDeleteWorkspace';
import { useOpenWorkspace } from '../hooks/useOpenWorkspace';
import { useSettings } from '../hooks/useSettings';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { getWorkspace } from '../lib/store';
import type { ButtonProps } from './core/Button';
import { Button } from './core/Button';
import type { DropdownItem } from './core/Dropdown';
import { Icon } from './core/Icon';
import type { RadioDropdownItem } from './core/RadioDropdown';
import { RadioDropdown } from './core/RadioDropdown';
import { useDialog } from './DialogContext';
import { OpenWorkspaceDialog } from './OpenWorkspaceDialog';
import { WorkspaceSettingsDialog } from './WorkpaceSettingsDialog';

type Props = Pick<ButtonProps, 'className' | 'justify' | 'forDropdown' | 'leftSlot'>;

export const WorkspaceActionsDropdown = memo(function WorkspaceActionsDropdown({
  className,
  ...buttonProps
}: Props) {
  const workspaces = useWorkspaces();
  const activeWorkspace = useActiveWorkspace();
  const activeWorkspaceId = activeWorkspace?.id ?? null;
  const deleteWorkspace = useDeleteWorkspace(activeWorkspace);
  const createWorkspace = useCreateWorkspace();
  const dialog = useDialog();
  const settings = useSettings();
  const openWorkspace = useOpenWorkspace();
  const openWorkspaceNewWindow = settings?.openWorkspaceNewWindow ?? null;
  const deleteSendHistory = useDeleteSendHistory();

  const { workspaceItems, extraItems } = useMemo<{
    workspaceItems: RadioDropdownItem[];
    extraItems: DropdownItem[];
  }>(() => {
    const workspaceItems: RadioDropdownItem[] = workspaces.map((w) => ({
      key: w.id,
      label: w.name,
      value: w.id,
      leftSlot: w.id === activeWorkspaceId ? <Icon icon="check" /> : <Icon icon="empty" />,
    }));

    const extraItems: DropdownItem[] = [
      {
        key: 'workspace-settings',
        label: 'Settings',
        leftSlot: <Icon icon="settings" />,
        onSelect: async () => {
          dialog.show({
            id: 'workspace-settings',
            title: 'Workspace Settings',
            size: 'md',
            render: () => <WorkspaceSettingsDialog workspaceId={activeWorkspace?.id ?? null} />,
          });
        },
      },
      {
        key: 'delete-responses',
        label: 'Clear Send History',
        leftSlot: <Icon icon="history" />,
        onSelect: deleteSendHistory.mutate,
      },
      {
        key: 'delete',
        label: 'Delete Workspace',
        leftSlot: <Icon icon="trash" />,
        onSelect: deleteWorkspace.mutate,
        variant: 'danger',
      },
      { type: 'separator' },
      {
        key: 'create-workspace',
        label: 'New Workspace',
        leftSlot: <Icon icon="plus" />,
        onSelect: createWorkspace.mutate,
      },
    ];

    return { workspaceItems, extraItems };
  }, [
    activeWorkspace,
    activeWorkspaceId,
    createWorkspace.mutate,
    deleteSendHistory.mutate,
    deleteWorkspace.mutate,
    dialog,
    workspaces,
  ]);

  const handleChange = useCallback(
    async (workspaceId: string | null) => {
      if (workspaceId == null) return;

      if (typeof openWorkspaceNewWindow === 'boolean') {
        openWorkspace.mutate({ workspaceId, inNewWindow: openWorkspaceNewWindow });
        return;
      }

      const workspace = await getWorkspace(workspaceId);
      if (workspace == null) return;

      dialog.show({
        id: 'open-workspace',
        size: 'sm',
        title: 'Open Workspace',
        render: ({ hide }) => <OpenWorkspaceDialog workspace={workspace} hide={hide} />,
      });
    },
    [dialog, openWorkspace, openWorkspaceNewWindow],
  );

  return (
    <RadioDropdown
      items={workspaceItems}
      extraItems={extraItems}
      onChange={handleChange}
      value={activeWorkspaceId}
    >
      <Button
        size="sm"
        className={classNames(
          className,
          'text !px-2 truncate',
          activeWorkspace === null && 'italic opacity-disabled',
        )}
        {...buttonProps}
      >
        {activeWorkspace?.name ?? 'Workspace'}
      </Button>
    </RadioDropdown>
  );
});
