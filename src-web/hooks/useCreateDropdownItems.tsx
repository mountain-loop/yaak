import { useMemo } from 'react';
import { createFolder } from '../commands/commands';
import type { DropdownItem } from '../components/core/Dropdown';
import { Icon } from '../components/core/Icon';
import { generateId } from '../lib/generateId';
import { BODY_TYPE_GRAPHQL } from '../lib/model_util';
import { getActiveRequest } from './useActiveRequest';
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

  return useMemo((): DropdownItem[] => {
    const folderId =
      folderIdOption === 'active-folder' ? getActiveRequest()?.folderId : folderIdOption;

    return [
      {
        key: 'create-http-request',
        label: 'HTTP Request',
        leftSlot: hideIcons ? undefined : <Icon icon="plus" />,
        onSelect: () => {
          createHttpRequest({ folderId });
        },
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
              onSelect: () => createFolder.mutate({ folderId }),
            },
          ]) as DropdownItem[]),
    ];
  }, [createGrpcRequest, createHttpRequest, folderIdOption, hideFolder, hideIcons]);
}
