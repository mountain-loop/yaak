import React, { useMemo } from 'react';
import { useCreateDropdownItems } from '../../hooks/useCreateDropdownItems';
import { useDeleteFolder } from '../../hooks/useDeleteFolder';
import { useDeleteAnyRequest } from '../../hooks/useDeleteAnyRequest';
import { useDuplicateFolder } from '../../hooks/useDuplicateFolder';
import { useDuplicateGrpcRequest } from '../../hooks/useDuplicateGrpcRequest';
import { useDuplicateHttpRequest } from '../../hooks/useDuplicateHttpRequest';
import { useHttpRequestActions } from '../../hooks/useHttpRequestActions';
import { useMoveToWorkspace } from '../../hooks/useMoveToWorkspace';
import { useRenameRequest } from '../../hooks/useRenameRequest';
import { useSendAnyHttpRequest } from '../../hooks/useSendAnyHttpRequest';
import { useSendManyRequests } from '../../hooks/useSendManyRequests';
import { useWorkspaces } from '../../hooks/useWorkspaces';

import { showDialog } from '../../lib/dialog';
import type { DropdownItem } from '../core/Dropdown';
import { ContextMenu } from '../core/Dropdown';
import { Icon } from '../core/Icon';
import { FolderSettingsDialog } from '../FolderSettingsDialog';
import type { SidebarTreeNode } from './Sidebar';
import { getHttpRequest } from '../../hooks/useHttpRequests';

interface Props {
  child: SidebarTreeNode;
  show: { x: number; y: number } | null;
  close: () => void;
}

export function SidebarItemContextMenu({ child, show, close }: Props) {
  const sendManyRequests = useSendManyRequests();
  const duplicateFolder = useDuplicateFolder(child.id);
  const deleteFolder = useDeleteFolder(child.id);
  const httpRequestActions = useHttpRequestActions();
  const sendRequest = useSendAnyHttpRequest();
  const workspaces = useWorkspaces();
  const deleteRequest = useDeleteAnyRequest();
  const renameRequest = useRenameRequest(child.id);
  const duplicateHttpRequest = useDuplicateHttpRequest({ id: child.id, navigateAfter: true });
  const duplicateGrpcRequest = useDuplicateGrpcRequest({ id: child.id, navigateAfter: true });
  const moveToWorkspace = useMoveToWorkspace(child.id);
  const createDropdownItems = useCreateDropdownItems({
    folderId: child.model === 'folder' ? child.id : null,
  });

  const items = useMemo((): DropdownItem[] => {
    if (child.model === 'folder') {
      return [
        {
          label: 'Send All',
          leftSlot: <Icon icon="send_horizontal" />,
          onSelect: () => sendManyRequests.mutate(child.children.map((c) => c.id)),
        },
        {
          label: 'Settings',
          leftSlot: <Icon icon="settings" />,
          onSelect: () =>
            showDialog({
              id: 'folder-settings',
              title: 'Folder Settings',
              size: 'md',
              render: () => <FolderSettingsDialog folderId={child.id} />,
            }),
        },
        {
          label: 'Duplicate',
          leftSlot: <Icon icon="copy" />,
          onSelect: () => duplicateFolder.mutate(),
        },
        {
          label: 'Delete',
          color: 'danger',
          leftSlot: <Icon icon="trash" />,
          onSelect: () => deleteFolder.mutate(),
        },
        { type: 'separator' },
        ...createDropdownItems,
      ];
    } else {
      const requestItems: DropdownItem[] =
        child.model === 'http_request'
          ? [
              {
                label: 'Send',
                hotKeyAction: 'http_request.send',
                hotKeyLabelOnly: true, // Already bound in URL bar
                leftSlot: <Icon icon="send_horizontal" />,
                onSelect: () => sendRequest.mutate(child.id),
              },
              ...httpRequestActions.map((a) => ({
                label: a.label,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                leftSlot: <Icon icon={(a.icon as any) ?? 'empty'} />,
                onSelect: async () => {
                  const request = getHttpRequest(child.id);
                  if (request != null) await a.call(request);
                },
              })),
              { type: 'separator' },
            ]
          : [];
      return [
        ...requestItems,
        {
          label: 'Rename',
          leftSlot: <Icon icon="pencil" />,
          onSelect: renameRequest.mutate,
        },
        {
          label: 'Duplicate',
          hotKeyAction: 'http_request.duplicate',
          hotKeyLabelOnly: true, // Would trigger for every request (bad)
          leftSlot: <Icon icon="copy" />,
          onSelect: () =>
            child.model === 'http_request'
              ? duplicateHttpRequest.mutate()
              : duplicateGrpcRequest.mutate(),
        },
        {
          label: 'Move',
          leftSlot: <Icon icon="arrow_right_circle" />,
          hidden: workspaces.length <= 1,
          onSelect: moveToWorkspace.mutate,
        },
        {
          color: 'danger',
          label: 'Delete',
          hotKeyAction: 'http_request.delete',
          hotKeyLabelOnly: true,
          leftSlot: <Icon icon="trash" />,
          onSelect: () => deleteRequest.mutate(child.id),
        },
      ];
    }
  }, [
    child.children,
    child.id,
    child.model,
    createDropdownItems,
    deleteFolder,
    deleteRequest,
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
