import { useMemo } from 'react';
import type { DropdownItem } from '../components/core/Dropdown';
import { Icon } from '../components/core/Icon';
import { generateId } from '../lib/generateId';
import { BODY_TYPE_GRAPHQL } from '../lib/model_util';
import { useCreateFolder } from './useCreateFolder';
import { useCreateGrpcRequest } from './useCreateGrpcRequest';
import { useCreateHttpRequest } from './useCreateHttpRequest';

export function useCreateDropdownItems({
  hideFolder,
  hideIcons,
  folderId,
}: {
  hideFolder?: boolean;
  hideIcons?: boolean;
  folderId?: string | null;
} = {}): DropdownItem[] {
  const { mutate: createHttpRequest } = useCreateHttpRequest();
  const { mutate: createGrpcRequest } = useCreateGrpcRequest();
  const { mutate: createFolder } = useCreateFolder();

  return useMemo<DropdownItem[]>(
    () => [
      {
        key: 'create-http-request',
        label: 'HTTP Request',
        leftSlot: hideIcons ? undefined : <Icon icon="plus" />,
        onSelect: () => createHttpRequest({ folderId }),
      },
      {
        key: 'create-graphql-request',
        label: 'GraphQL Query',
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
        key: 'create-grpc-request',
        label: 'gRPC Call',
        leftSlot: hideIcons ? undefined : <Icon icon="plus" />,
        onSelect: () => createGrpcRequest({ folderId }),
      },
      ...((hideFolder
        ? []
        : [
            {
              type: 'separator',
            },
            {
              key: 'create-folder',
              label: 'Folder',
              leftSlot: hideIcons ? undefined : <Icon icon="plus" />,
              onSelect: () => createFolder({ folderId }),
            },
          ]) as DropdownItem[]),
    ],
    [createFolder, createGrpcRequest, createHttpRequest, folderId, hideFolder, hideIcons],
  );
}
