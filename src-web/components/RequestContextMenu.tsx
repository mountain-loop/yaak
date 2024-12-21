import React, { useMemo } from 'react';
import { useCreateDropdownItems } from '../hooks/useCreateDropdownItems';
import { useDeleteFolder } from '../hooks/useDeleteFolder';
import { useDeleteRequest } from '../hooks/useDeleteRequest';
import { useDuplicateFolder } from '../hooks/useDuplicateFolder';
import { useDuplicateGrpcRequest } from '../hooks/useDuplicateGrpcRequest';
import { useDuplicateHttpRequest } from '../hooks/useDuplicateHttpRequest';
import { useHttpRequestActions } from '../hooks/useHttpRequestActions';
import { useMoveToWorkspace } from '../hooks/useMoveToWorkspace';
import { useRenameRequest } from '../hooks/useRenameRequest';
import { useSendAnyHttpRequest } from '../hooks/useSendAnyHttpRequest';
import { useSendManyRequests } from '../hooks/useSendManyRequests';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { getHttpRequest } from '../lib/store';
import type { DropdownItem } from './core/Dropdown';
import { ContextMenu } from './core/Dropdown';
import { Icon } from './core/Icon';
import { useDialog } from '../hooks/useDialog';
import { FolderSettingsDialog } from './FolderSettingsDialog';
import type { SidebarTreeNode } from './Sidebar';

interface Props {
  child: SidebarTreeNode;
  show: { x: number; y: number } | null;
  close: () => void;
}

export function RequestContextMenu({ child, show, close }: Props) {
  const sendManyRequests = useSendManyRequests();
  const duplicateFolder = useDuplicateFolder(child.item.id);
  const deleteFolder = useDeleteFolder(child.item.id);
  const httpRequestActions = useHttpRequestActions();
  const sendRequest = useSendAnyHttpRequest();
  const workspaces = useWorkspaces();
  const dialog = useDialog();
  const deleteRequest = useDeleteRequest(child.item.id);
  const renameRequest = useRenameRequest(child.item.id);
  const duplicateHttpRequest = useDuplicateHttpRequest({ id: child.item.id, navigateAfter: true });
  const duplicateGrpcRequest = useDuplicateGrpcRequest({ id: child.item.id, navigateAfter: true });
  const moveToWorkspace = useMoveToWorkspace(child.item.id);
  const createDropdownItems = useCreateDropdownItems({
    folderId: child.item.model === 'folder' ? child.item.id : null,
  });

  const items = useMemo<DropdownItem[]>(() => {
    if (child.item.model === 'folder') {
      return [
        {
          key: 'send-all',
          label: 'Send All',
          leftSlot: <Icon icon="send_horizontal" />,
          onSelect: () => sendManyRequests.mutate(child.children.map((c) => c.item.id)),
        },
        {
          key: 'folder-settings',
          label: 'Settings',
          leftSlot: <Icon icon="settings" />,
          onSelect: () =>
            dialog.show({
              id: 'folder-settings',
              title: 'Folder Settings',
              size: 'md',
              render: () => <FolderSettingsDialog folderId={child.item.id} />,
            }),
        },
        {
          key: 'duplicateFolder',
          label: 'Duplicate',
          leftSlot: <Icon icon="copy" />,
          onSelect: () => duplicateFolder.mutate(),
        },
        {
          key: 'delete-folder',
          label: 'Delete',
          variant: 'danger',
          leftSlot: <Icon icon="trash" />,
          onSelect: () => deleteFolder.mutate(),
        },
        { type: 'separator' },
        ...createDropdownItems,
      ];
    } else {
      const requestItems: DropdownItem[] =
        child.item.model === 'http_request'
          ? [
              {
                key: 'send-request',
                label: 'Send',
                hotKeyAction: 'http_request.send',
                hotKeyLabelOnly: true, // Already bound in URL bar
                leftSlot: <Icon icon="send_horizontal" />,
                onSelect: () => sendRequest.mutate(child.item.id),
              },
              ...httpRequestActions.map((a) => ({
                key: a.key,
                label: a.label,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                leftSlot: <Icon icon={(a.icon as any) ?? 'empty'} />,
                onSelect: async () => {
                  const request = await getHttpRequest(child.item.id);
                  if (request != null) await a.call(request);
                },
              })),
              { type: 'separator' },
            ]
          : [];
      return [
        ...requestItems,
        {
          key: 'rename-request',
          label: 'Rename',
          leftSlot: <Icon icon="pencil" />,
          onSelect: renameRequest.mutate,
        },
        {
          key: 'duplicate-request',
          label: 'Duplicate',
          hotKeyAction: 'http_request.duplicate',
          hotKeyLabelOnly: true, // Would trigger for every request (bad)
          leftSlot: <Icon icon="copy" />,
          onSelect: () =>
            child.item.model === 'http_request'
              ? duplicateHttpRequest.mutate()
              : duplicateGrpcRequest.mutate(),
        },
        {
          key: 'move-workspace',
          label: 'Move',
          leftSlot: <Icon icon="arrow_right_circle" />,
          hidden: workspaces.length <= 1,
          onSelect: moveToWorkspace.mutate,
        },
        {
          key: 'delete-request',
          variant: 'danger',
          label: 'Delete',
          leftSlot: <Icon icon="trash" />,
          onSelect: () => deleteRequest.mutate(),
        },
      ];
    }
  }, [
    child.children,
    child.item.id,
    child.item.model,
    createDropdownItems,
    deleteFolder,
    deleteRequest,
    dialog,
    duplicateFolder,
    duplicateGrpcRequest,
    duplicateHttpRequest,
    httpRequestActions,
    moveToWorkspace.mutate,
    renameRequest.mutate,
    sendManyRequests,
    sendRequest,
    workspaces.length,
  ]);

  return <ContextMenu triggerPosition={show} items={items} onClose={close} />;
}
