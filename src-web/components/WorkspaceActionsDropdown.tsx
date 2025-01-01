import classNames from 'classnames';
import { memo, useCallback, useMemo } from 'react';
import { useActiveWorkspace } from '../hooks/useActiveWorkspace';
import { useCreateWorkspace } from '../hooks/useCreateWorkspace';
import { useDeleteSendHistory } from '../hooks/useDeleteSendHistory';
import { useDeleteWorkspace } from '../hooks/useDeleteWorkspace';
import { useDialog } from '../hooks/useDialog';
import { useOpenWorkspace } from '../hooks/useOpenWorkspace';
import { useSettings } from '../hooks/useSettings';
import { useUpdateWorkspace } from '../hooks/useUpdateWorkspace';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { getWorkspace } from '../lib/store';
import type { ButtonProps } from './core/Button';
import { Button } from './core/Button';
import type { DropdownItem } from './core/Dropdown';
import { Icon } from './core/Icon';
import type { RadioDropdownItem } from './core/RadioDropdown';
import { RadioDropdown } from './core/RadioDropdown';
import { OpenWorkspaceDialog } from './OpenWorkspaceDialog';
import { WorkspaceSettingsDialog } from './WorkpaceSettingsDialog';
import { usePrompt } from '../hooks/usePrompt';
import { InlineCode } from './core/InlineCode';

type Props = Pick<ButtonProps, 'className' | 'justify' | 'forDropdown' | 'leftSlot'>;

export const WorkspaceActionsDropdown = memo(function WorkspaceActionsDropdown({
  className,
  ...buttonProps
}: Props) {
  const workspaces = useWorkspaces();
  const activeWorkspace = useActiveWorkspace();
  const activeWorkspaceId = activeWorkspace?.id ?? null;
  const { mutate: deleteWorkspace } = useDeleteWorkspace(activeWorkspace);
  const { mutate: createWorkspace } = useCreateWorkspace();
  const { mutate: updateWorkspace } = useUpdateWorkspace(activeWorkspaceId);
  const { mutate: deleteSendHistory } = useDeleteSendHistory();
  const dialog = useDialog();
  const prompt = usePrompt();
  const settings = useSettings();
  const openWorkspace = useOpenWorkspace();
  const openWorkspaceNewWindow = settings?.openWorkspaceNewWindow ?? null;

  const orderedWorkspaces = useMemo(
    () => [...workspaces].sort((a, b) => (a.name.localeCompare(b.name) > 0 ? 1 : -1)),
    [workspaces],
  );

  const { workspaceItems, extraItems } = useMemo<{
    workspaceItems: RadioDropdownItem[];
    extraItems: DropdownItem[];
  }>(() => {
    const workspaceItems: RadioDropdownItem[] = orderedWorkspaces.map((w) => ({
      key: w.id,
      label: w.name,
      value: w.id,
      leftSlot: w.id === activeWorkspaceId ? <Icon icon="check" /> : <Icon icon="empty" />,
    }));

    const extraItems: DropdownItem[] = [
      {
        key: 'workspace-settings',
        label: 'Workspace Settings',
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
        key: 'sync-dir',
        label: 'Directory Sync',
        leftSlot: <Icon icon="folder_sync" />,
        onSelect: async () => {
          const settingSyncDir = await prompt({
            id: 'workspace-sync-dir',
            title: 'Select sync dir',
            description: (
              <>
                Select a sync dir for <InlineCode>{activeWorkspace?.name}</InlineCode>
              </>
            ),
            label: 'Directory',
            placeholder: '/User/foo',
            defaultValue: activeWorkspace?.settingSyncDir ?? undefined,
          });
          if (settingSyncDir == null) return;
          updateWorkspace({ settingSyncDir });
        },
      },
      {
        key: 'delete-responses',
        label: 'Clear Send History',
        leftSlot: <Icon icon="history" />,
        onSelect: deleteSendHistory,
      },
      {
        key: 'delete',
        label: 'Delete Workspace',
        leftSlot: <Icon icon="trash" />,
        onSelect: deleteWorkspace,
        variant: 'danger',
      },
      { type: 'separator' },
      {
        key: 'create-workspace',
        label: 'New Workspace',
        leftSlot: <Icon icon="plus" />,
        onSelect: createWorkspace,
      },
    ];

    return { workspaceItems, extraItems };
  }, [
    activeWorkspace?.id,
    activeWorkspace?.name,
    activeWorkspace?.settingSyncDir,
    activeWorkspaceId,
    createWorkspace,
    deleteSendHistory,
    deleteWorkspace,
    dialog,
    orderedWorkspaces,
    prompt,
    updateWorkspace,
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
