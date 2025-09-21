import { duplicateModelById, getModel, workspacesAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import React, { useMemo } from 'react';
import { openFolderSettings } from '../../commands/openFolderSettings';
import { useCreateDropdownItems } from '../../hooks/useCreateDropdownItems';
import { useGrpcRequestActions } from '../../hooks/useGrpcRequestActions';
import { useHttpRequestActions } from '../../hooks/useHttpRequestActions';
import { useMoveToWorkspace } from '../../hooks/useMoveToWorkspace';
import { useSendAnyHttpRequest } from '../../hooks/useSendAnyHttpRequest';
import { useSendManyRequests } from '../../hooks/useSendManyRequests';
import { deleteModelWithConfirm } from '../../lib/deleteModelWithConfirm';

import { duplicateRequestAndNavigate } from '../../lib/duplicateRequestAndNavigate';
import { renameModelWithPrompt } from '../../lib/renameModelWithPrompt';
import type { DropdownItem } from '../core/Dropdown';
import { ContextMenu } from '../core/Dropdown';
import { Icon } from '../core/Icon';
import type { SidebarTreeNode } from './Sidebar';

interface Props {
  child: SidebarTreeNode;
  show: { x: number; y: number } | null;
  close: () => void;
}

export function SidebarItemContextMenu({ child, show, close }: Props) {
  const sendManyRequests = useSendManyRequests();
  const httpRequestActions = useHttpRequestActions();
  const grpcRequestActions = useGrpcRequestActions();
  const sendRequest = useSendAnyHttpRequest();
  const workspaces = useAtomValue(workspacesAtom);
  const moveToWorkspace = useMoveToWorkspace(child.id);
  const createDropdownItems = useCreateDropdownItems({
    folderId: child.model === 'folder' ? child.id : null,
  });

  const items = useMemo((): DropdownItem[] => {
    if (child.model === 'folder') {
      return [
        {
          label: 'Settings',
          leftSlot: <Icon icon="settings" />,
          onSelect: () => openFolderSettings(child.id),
        },
        {
          label: 'Duplicate',
          leftSlot: <Icon icon="copy" />,
          onSelect: () => duplicateModelById(child.model, child.id),
        },
        {
          label: 'Send All',
          leftSlot: <Icon icon="send_horizontal" />,
          onSelect: () => sendManyRequests.mutate(child.children.map((c) => c.id)),
        },
        {
          label: 'Delete',
          color: 'danger',
          leftSlot: <Icon icon="trash" />,
          onSelect: async () => {
            await deleteModelWithConfirm(getModel(child.model, child.id));
          },
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
                const request = getModel('http_request', child.id);
                if (request != null) await a.call(request);
              },
            })),
            { type: 'separator' },
          ]
          : child.model === 'grpc_request'
            ? grpcRequestActions.map((a) => ({
              label: a.label,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              leftSlot: <Icon icon={(a.icon as any) ?? 'empty'} />,
              onSelect: async () => {
                const request = getModel('grpc_request', child.id);
                if (request != null) await a.call(request);
              },
            }))
            : [];
      return [
        ...requestItems,
        {
          label: 'Rename',
          leftSlot: <Icon icon="pencil" />,
          onSelect: async () => {
            const request = getModel(
              ['http_request', 'grpc_request', 'websocket_request'],
              child.id,
            );
            await renameModelWithPrompt(request);
          },
        },
        {
          label: 'Duplicate',
          hotKeyAction: 'http_request.duplicate',
          hotKeyLabelOnly: true, // Would trigger for every request (bad)
          leftSlot: <Icon icon="copy" />,
          onSelect: async () => {
            const request = getModel(
              ['http_request', 'grpc_request', 'websocket_request'],
              child.id,
            );
            await duplicateRequestAndNavigate(request);
          },
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
          hotKeyAction: 'sidebar.delete_selected_item',
          hotKeyLabelOnly: true,
          leftSlot: <Icon icon="trash" />,
          onSelect: async () => {
            await deleteModelWithConfirm(getModel(child.model, child.id));
          },
        },
      ];
    }
  }, [
    child.children,
    child.id,
    child.model,
    createDropdownItems,
    httpRequestActions,
    grpcRequestActions,
    moveToWorkspace.mutate,
    sendManyRequests,
    sendRequest,
    workspaces.length,
  ]);

  return <ContextMenu triggerPosition={show} items={items} onClose={close} />;
}
