import type { HttpRequest, WebsocketRequest } from '@yaakapp-internal/models';
import type { GrpcRequest } from '@yaakapp-internal/sync';
import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { createFolder } from '../commands/commands';
import type { DropdownItem } from '../components/core/Dropdown';
import { Icon } from '../components/core/Icon';
import { createRequestAndNavigate } from '../lib/createRequestAndNavigate';
import { generateId } from '../lib/generateId';
import { BODY_TYPE_GRAPHQL } from '../lib/model_util';
import { activeRequestAtom } from './useActiveRequest';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';

export function useCreateDropdownItems({
  hideFolder,
  hideIcons,
  folderId,
}: {
  hideFolder?: boolean;
  hideIcons?: boolean;
  folderId?: string | null | 'active-folder';
} = {}): DropdownItem[] {
  const workspaceId = useAtomValue(activeWorkspaceIdAtom);
  const activeRequest = useAtomValue(activeRequestAtom);

  const items = useMemo((): DropdownItem[] => {
    return getCreateDropdownItems({ hideFolder, hideIcons, folderId, activeRequest, workspaceId });
  }, [activeRequest, folderId, hideFolder, hideIcons, workspaceId]);

  return items;
}

export function getCreateDropdownItems({
  hideFolder,
  hideIcons,
  folderId: folderIdOption,
  workspaceId,
  activeRequest,
  onCreate,
}: {
  hideFolder?: boolean;
  hideIcons?: boolean;
  folderId?: string | null | 'active-folder';
  workspaceId: string | null;
  activeRequest: HttpRequest | GrpcRequest | WebsocketRequest | null;
  onCreate?: (
    model: 'http_request' | 'grpc_request' | 'websocket_request' | 'folder',
    id: string,
  ) => void;
}): DropdownItem[] {
  const folderId =
    (folderIdOption === 'active-folder' ? activeRequest?.folderId : folderIdOption) ?? null;

  if (workspaceId == null) {
    return [];
  }

  return [
    {
      label: 'HTTP',
      leftSlot: hideIcons ? undefined : <Icon icon="plus" />,
      onSelect: async () => {
        const id = await createRequestAndNavigate({ model: 'http_request', workspaceId, folderId });
        onCreate?.('http_request', id);
      },
    },
    {
      label: 'GraphQL',
      leftSlot: hideIcons ? undefined : <Icon icon="plus" />,
      onSelect: async () => {
        const id = await createRequestAndNavigate({
          model: 'http_request',
          workspaceId,
          folderId,
          bodyType: BODY_TYPE_GRAPHQL,
          method: 'POST',
          headers: [{ name: 'Content-Type', value: 'application/json', id: generateId() }],
        });
        onCreate?.('http_request', id);
      },
    },
    {
      label: 'gRPC',
      leftSlot: hideIcons ? undefined : <Icon icon="plus" />,
      onSelect: async () => {
        const id = await createRequestAndNavigate({ model: 'grpc_request', workspaceId, folderId });
        onCreate?.('grpc_request', id);
      },
    },
    {
      label: 'WebSocket',
      leftSlot: hideIcons ? undefined : <Icon icon="plus" />,
      onSelect: async () => {
        const id = await createRequestAndNavigate({
          model: 'websocket_request',
          workspaceId,
          folderId,
        });
        onCreate?.('websocket_request', id);
      },
    },
    ...((hideFolder
      ? []
      : [
          { type: 'separator' },
          {
            label: 'Folder',
            leftSlot: hideIcons ? undefined : <Icon icon="plus" />,
            onSelect: async () => {
              const id = await createFolder.mutateAsync({ folderId });
              if (id != null) {
                onCreate?.('folder', id);
              }
            },
          },
        ]) as DropdownItem[]),
  ];
}
