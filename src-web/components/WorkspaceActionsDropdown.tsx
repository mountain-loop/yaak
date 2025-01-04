import { applySync, calculateSync } from '@yaakapp-internal/sync';
import classNames from 'classnames';
import { memo, useCallback, useMemo } from 'react';
import { useActiveWorkspace } from '../hooks/useActiveWorkspace';
import { useConfirm } from '../hooks/useConfirm';
import { useCreateWorkspace } from '../hooks/useCreateWorkspace';
import { useDeleteSendHistory } from '../hooks/useDeleteSendHistory';
import { useDialog } from '../hooks/useDialog';
import { useOpenWorkspace } from '../hooks/useOpenWorkspace';
import { useSettings } from '../hooks/useSettings';
import { useToast } from '../hooks/useToast';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { pluralizeCount } from '../lib/pluralize';
import { getWorkspace } from '../lib/store';
import type { ButtonProps } from './core/Button';
import { Button } from './core/Button';
import type { DropdownItem } from './core/Dropdown';
import { Icon } from './core/Icon';
import type { RadioDropdownItem } from './core/RadioDropdown';
import { RadioDropdown } from './core/RadioDropdown';
import { OpenWorkspaceDialog } from './OpenWorkspaceDialog';
import { WorkspaceSettingsDialog } from './WorkspaceSettingsDialog';

type Props = Pick<ButtonProps, 'className' | 'justify' | 'forDropdown' | 'leftSlot'>;

export const WorkspaceActionsDropdown = memo(function WorkspaceActionsDropdown({
  className,
  ...buttonProps
}: Props) {
  const workspaces = useWorkspaces();
  const activeWorkspace = useActiveWorkspace();
  const createWorkspace = useCreateWorkspace();
  const { mutate: deleteSendHistory } = useDeleteSendHistory();
  const dialog = useDialog();
  const confirm = useConfirm();
  const toast = useToast();
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
      leftSlot: w.id === activeWorkspace?.id ? <Icon icon="check" /> : <Icon icon="empty" />,
    }));

    const extraItems: DropdownItem[] = [
      {
        key: 'workspace-settings',
        label: 'Workspace Settings',
        leftSlot: <Icon icon="settings" />,
        hotKeyAction: 'workspace_settings.show',
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
        key: 'sync',
        label: 'Sync Workspace',
        leftSlot: <Icon icon="folder_sync" />,
        hidden: !activeWorkspace?.settingSyncDir,
        onSelect: async () => {
          if (activeWorkspace == null) return;

          const ops = await calculateSync(activeWorkspace);
          if (ops.length === 0) {
            toast.show({
              id: 'no-sync-changes',
              message: 'No changes detected for sync',
            });
            return;
          }

          const dbChanges = ops.filter((o) => o.type.startsWith('db'));

          if (dbChanges.length === 0) {
            await applySync(activeWorkspace, ops);
            toast.show({
              id: 'applied-sync-changes',
              message: `Applied ${pluralizeCount('change', ops.length)}`,
            });
            return;
          }

          const confirmed = await confirm({
            id: 'commit-sync',
            title: 'Filesystem Changes',
            confirmText: 'Apply Changes',
            description: (
              <p>
                <strong>The filesystem has changed since last sync.</strong> Do you want to update
                the workspace to match?
              </p>
            ),
          });
          if (confirmed) {
            await applySync(activeWorkspace, ops);
            toast.show({
              id: 'applied-confirmed-sync-changes',
              message: `Applied ${pluralizeCount('change', ops.length)}`,
            });
          }
        },
      },
      {
        key: 'delete-responses',
        label: 'Clear Send History',
        leftSlot: <Icon icon="history" />,
        onSelect: deleteSendHistory,
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
    orderedWorkspaces,
    activeWorkspace,
    deleteSendHistory,
    createWorkspace,
    dialog,
    confirm,
    toast,
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
      value={activeWorkspace?.id ?? null}
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
