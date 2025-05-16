import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { createFolder } from '../commands/commands';
import type { DropdownItem } from '../components/core/Dropdown';
import { Icon } from '../components/core/Icon';
import { createRequestAndNavigate } from '../lib/createRequestAndNavigate';
import { generateId } from '../lib/generateId';
import { jotaiStore } from '../lib/jotai';
import { BODY_TYPE_GRAPHQL } from '../lib/model_util';
import { activeRequestAtom } from './useActiveRequest';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';

export function useCreateDropdownItems({
  hideFolder,
  hideIcons,
  folderId: folderIdOption,
}: {
  hideFolder?: boolean;
  hideIcons?: boolean;
  folderId?: string | null | 'active-folder';
} = {}): DropdownItem[] {
  const workspaceId = useAtomValue(activeWorkspaceIdAtom);

  const items = useMemo((): DropdownItem[] => {
    const activeRequest = jotaiStore.get(activeRequestAtom);
    const folderId =
      (folderIdOption === 'active-folder' ? activeRequest?.folderId : folderIdOption) ?? null;
    if (workspaceId == null) return [];

    return [
      {
        label: 'HTTP',
        leftSlot: hideIcons ? undefined : <Icon icon="plus" />,
        onSelect: () => createRequestAndNavigate({ model: 'http_request', workspaceId, folderId }),
      },
      {
        label: 'GraphQL',
        leftSlot: hideIcons ? undefined : <Icon icon="plus" />,
        onSelect: () =>
          createRequestAndNavigate({
            model: 'http_request',
            workspaceId,
            folderId,
            bodyType: BODY_TYPE_GRAPHQL,
            method: 'POST',
            headers: [{ name: 'Content-Type', value: 'application/json', id: generateId() }],
          }),
      },
      {
        label: 'gRPC',
        leftSlot: hideIcons ? undefined : <Icon icon="plus" />,
        onSelect: () => createRequestAndNavigate({ model: 'grpc_request', workspaceId, folderId }),
      },
      {
        label: 'WebSocket',
        leftSlot: hideIcons ? undefined : <Icon icon="plus" />,
        onSelect: () =>
          createRequestAndNavigate({ model: 'websocket_request', workspaceId, folderId }),
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
  }, [folderIdOption, hideFolder, hideIcons, workspaceId]);

  return items;
}
