import { useMemo } from 'react';
import { createFolder } from '../commands/commands';
import { upsertWebsocketRequest } from '../commands/upsertWebsocketRequest';
import type { DropdownItem } from '../components/core/Dropdown';
import { Icon } from '../components/core/Icon';
import { generateId } from '../lib/generateId';
import { BODY_TYPE_GRAPHQL } from '../lib/model_util';
import { getActiveRequest } from './useActiveRequest';
import { getActiveWorkspace } from './useActiveWorkspace';
import { useCreateGrpcRequest } from './useCreateGrpcRequest';
import { useCreateHttpRequest } from './useCreateHttpRequest';

export function useCreateDropdownItems({
  hideFolder,
  hideIcons,
  folderId: folderIdOption,
}: {
  hideFolder?: boolean;
  hideIcons?: boolean;
  folderId?: string | null | 'active-folder';
} = {}): DropdownItem[] {
  const { mutate: createHttpRequest } = useCreateHttpRequest();
  const { mutate: createGrpcRequest } = useCreateGrpcRequest();
  const activeWorkspace = getActiveWorkspace();

  const items = useMemo((): DropdownItem[] => {
    const activeRequest = getActiveRequest();
    const folderId =
      (folderIdOption === 'active-folder' ? activeRequest?.folderId : folderIdOption) ?? null;
    if (activeWorkspace == null) return [];

    return [
      {
        label: 'HTTP',
        leftSlot: hideIcons ? undefined : <Icon icon="plus" />,
        onSelect: () => {
          createHttpRequest({ folderId });
        },
      },
      {
        label: 'GraphQL',
        leftSlot: hideIcons ? undefined : <Icon icon="plus" />,
        onSelect: () =>
          createHttpRequest({
            folderId,
            bodyType: BODY_TYPE_GRAPHQL,
            method: 'POST',
            headers: [{ name: 'Content-Type', value: 'application/json', id: generateId() }],
          }),
      },
      {
        label: 'gRPC',
        leftSlot: hideIcons ? undefined : <Icon icon="plus" />,
        onSelect: () => createGrpcRequest({ folderId }),
      },
      {
        label: 'WebSocket',
        leftSlot: hideIcons ? undefined : <Icon icon="plus" />,
        onSelect: () =>
          upsertWebsocketRequest.mutate({ folderId, workspaceId: activeWorkspace.id }),
      },
      ...((hideFolder
        ? []
        : [
            { type: 'separator' },
            {
              label: 'Folder',
              leftSlot: hideIcons ? undefined : <Icon icon="plus" />,
              onSelect: () => createFolder.mutate({ folderId }),
            },
          ]) as DropdownItem[]),
    ];
  }, [
    activeWorkspace,
    createGrpcRequest,
    createHttpRequest,
    folderIdOption,
    hideFolder,
    hideIcons,
  ]);

  return items;
}
