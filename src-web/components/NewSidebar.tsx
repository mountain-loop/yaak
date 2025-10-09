import type {
  Folder,
  GrpcRequest,
  HttpRequest,
  WebsocketRequest,
  Workspace,
} from '@yaakapp-internal/models';
import {
  duplicateModelById,
  foldersAtom,
  getModel,
  httpResponsesAtom,
  patchModel,
  workspacesAtom,
} from '@yaakapp-internal/models';
import classNames from 'classnames';
import { atom, useAtomValue } from 'jotai';
import React, { useCallback } from 'react';
import { openFolderSettings } from '../commands/openFolderSettings';
import { activeFolderIdAtom } from '../hooks/useActiveFolderId';
import { activeRequestIdAtom } from '../hooks/useActiveRequestId';
import { activeWorkspaceAtom } from '../hooks/useActiveWorkspace';
import { allRequestsAtom } from '../hooks/useAllRequests';
import { sendAnyHttpRequest } from '../hooks/useSendAnyHttpRequest';
import { deepEqualAtom } from '../lib/atoms';
import { deleteModelWithConfirm } from '../lib/deleteModelWithConfirm';
import { duplicateRequestOrFolderAndNavigate } from '../lib/duplicateRequestOrFolderAndNavigate';
import { jotaiStore } from '../lib/jotai';
import { renameModelWithPrompt } from '../lib/renameModelWithPrompt';
import { resolvedModelName } from '../lib/resolvedModelName';
import { navigateToRequestOrFolderOrWorkspace } from '../lib/setWorkspaceSearchParams';
import type { ContextMenuProps } from './core/Dropdown';
import { HttpMethodTag } from './core/HttpMethodTag';
import { HttpStatusTag } from './core/HttpStatusTag';
import { Icon } from './core/Icon';
import { LoadingIcon } from './core/LoadingIcon';
import { selectedIdsFamily } from './core/tree/atoms';
import type { TreeNode } from './core/tree/common';
import { Tree } from './core/tree/Tree';
import type { TreeItemProps } from './core/tree/TreeItem';

type Model = Workspace | Folder | HttpRequest | GrpcRequest | WebsocketRequest;

const opacitySubtle = 'opacity-80';

function getItemKey(item: Model) {
  const responses = jotaiStore.get(httpResponsesAtom);
  const latestResponse = responses.find((r) => r.requestId === item.id) ?? null;
  return [item.id, item.name, latestResponse?.id ?? 'n/a'].join('::');
}

export function NewSidebar({ className }: { className?: string }) {
  const tree = useAtomValue(sidebarTreeAtom);
  const treeId = 'workspace.sidebar';

  const renderLeftSlot = useCallback((item: Model) => {
    if (item.model === 'folder') {
      return <Icon icon="folder" />;
    } else if (item.model === 'workspace') {
      return null;
    } else {
      const isSelected = jotaiStore.get(selectedIdsFamily(treeId)).includes(item.id);
      return (
        <HttpMethodTag
          short
          className={classNames('text-xs', !isSelected && opacitySubtle)}
          request={item}
        />
      );
    }
  }, []);

  const renderItem = useCallback((item: Model) => {
    const isSelected = jotaiStore.get(selectedIdsFamily(treeId)).includes(item.id);
    const responses = jotaiStore.get(httpResponsesAtom);
    const latestHttpResponse = responses.find((r) => r.requestId === item.id) ?? null;
    return (
      <div
        className={classNames(
          'flex items-center gap-2 min-w-0 h-full w-full text-left',
          isSelected && '!text-text',
        )}
      >
        <div className="truncate">{resolvedModelName(item)}</div>
        {latestHttpResponse && (
          <div className="ml-auto">
            {latestHttpResponse.state !== 'closed' ? (
              <LoadingIcon size="sm" className="text-text-subtlest" />
            ) : (
              <HttpStatusTag
                short
                className={classNames('text-xs', !isSelected && opacitySubtle)}
                response={latestHttpResponse}
              />
            )}
          </div>
        )}
      </div>
    );
  }, []);

  if (tree == null) {
    return null;
  }

  return (
    <div className={classNames(className, 'w-full h-full max-h-full')}>
      <Tree
        root={tree}
        treeId={treeId}
        getItemKey={getItemKey}
        renderItem={renderItem}
        renderLeftSlot={renderLeftSlot}
        getContextMenu={getContextMenu}
        onActivate={handleActivate}
        getEditOptions={getEditOptions}
        activeIdAtom={activeIdAtom}
        className="pl-3 pr-2 pt-2 pb-2"
      />
    </div>
  );
}

const activeIdAtom = atom<string | null>((get) => {
  return get(activeRequestIdAtom) || get(activeFolderIdAtom);
});

function getEditOptions(
  item: Model,
): ReturnType<NonNullable<TreeItemProps<Model>['getEditOptions']>> {
  return {
    onChange: handleSubmitEdit,
    defaultValue: resolvedModelName(item),
    placeholder: item.name,
  };
}

async function handleSubmitEdit(item: Model, text: string) {
  await patchModel(item, { name: text });
}

function handleActivate(items: Model[]) {
  const item = items[0];
  if (items.length === 1 && item) {
    navigateToRequestOrFolderOrWorkspace(item.id, item.model);
  }
}

function getContextMenu(items: Model[]): ContextMenuProps['items'] {
  const child = items[0];
  if (child == null) return [];
  const workspaces = jotaiStore.get(workspacesAtom);

  const menuItems: ContextMenuProps['items'] = [
    {
      label: 'Settings',
      hidden: !(items.length === 1 && child.model === 'folder'),
      leftSlot: <Icon icon="settings" />,
      onSelect: () => openFolderSettings(child.id),
    },
    {
      label: 'Duplicate',
      leftSlot: <Icon icon="copy" />,
      hotKeyAction: 'http_request.duplicate',
      hotKeyLabelOnly: true,
      onSelect: async () => {
        await duplicateModelById(child.model, child.id);
      },
    },
    {
      label: 'Send All',
      leftSlot: <Icon icon="send_horizontal" />,
      onSelect: () => {
        for (const item of items) {
          sendAnyHttpRequest.mutate(item.id);
        }
      },
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
    // ...createDropdownItems,
    {
      label: 'Send',
      hotKeyAction: 'http_request.send',
      hotKeyLabelOnly: true, // Already bound in URL bar
      leftSlot: <Icon icon="send_horizontal" />,
      onSelect: () => sendAnyHttpRequest.mutate(child.id),
    },
    // ...httpRequestActions.map((a) => ({
    //   label: a.label,
    //   // eslint-disable-next-line @typescript-eslint/no-explicit-any
    //   leftSlot: <Icon icon={(a.icon as any) ?? 'empty'} />,
    //   onSelect: async () => {
    //     const request = getModel('http_request', child.id);
    //     if (request != null) await a.call(request);
    //   },
    // })),
    { type: 'separator' },
    // ]
    // : child.model === 'grpc_request'
    //   ? grpcRequestActions.map((a) => ({
    //     label: a.label,
    //     // eslint-disable-next-line @typescript-eslint/no-explicit-any
    //     leftSlot: <Icon icon={(a.icon as any) ?? 'empty'} />,
    //     onSelect: async () => {
    //       const request = getModel('grpc_request', child.id);
    //       if (request != null) await a.call(request);
    //     },
    //   }))
    //   : [];
    // ...requestItems,
    {
      label: 'Rename',
      leftSlot: <Icon icon="pencil" />,
      onSelect: async () => {
        const request = getModel(['http_request', 'grpc_request', 'websocket_request'], child.id);
        await renameModelWithPrompt(request);
      },
    },
    {
      label: 'Duplicate',
      hotKeyAction: 'http_request.duplicate',
      hotKeyLabelOnly: true, // Would trigger for every request (bad)
      leftSlot: <Icon icon="copy" />,
      onSelect: async () => {
        const request = getModel(['http_request', 'grpc_request', 'websocket_request'], child.id);
        await duplicateRequestOrFolderAndNavigate(request);
      },
    },
    {
      label: 'Move',
      leftSlot: <Icon icon="arrow_right_circle" />,
      hidden: workspaces.length <= 1,
      // TODO
      // onSelect: moveToWorkspace.mutate,
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
  return menuItems;
}

const allPotentialChildrenAtom = atom<Model[]>((get) => {
  const requests = get(allRequestsAtom);
  const folders = get(foldersAtom);
  return [...requests, ...folders];
});

const memoAllPotentialChildrenAtom = deepEqualAtom(allPotentialChildrenAtom);

const sidebarTreeAtom = atom((get) => {
  const allModels = get(memoAllPotentialChildrenAtom);
  const activeWorkspace = get(activeWorkspaceAtom);

  const childrenMap: Record<string, Exclude<Model, Workspace>[]> = {};
  for (const item of allModels) {
    if ('folderId' in item && item.folderId == null) {
      childrenMap[item.workspaceId] = childrenMap[item.workspaceId] ?? [];
      childrenMap[item.workspaceId]!.push(item);
    } else if ('folderId' in item && item.folderId != null) {
      childrenMap[item.folderId] = childrenMap[item.folderId] ?? [];
      childrenMap[item.folderId]!.push(item);
    }
  }

  const treeParentMap: Record<string, TreeNode<Model>> = {};

  if (activeWorkspace == null) {
    return null;
  }

  // Put requests and folders into a tree structure
  const next = (node: TreeNode<Model>): TreeNode<Model> => {
    const childItems = childrenMap[node.item.id] ?? [];

    // Recurse to children
    childItems.sort((a, b) => a.sortPriority - b.sortPriority);
    if (node.item.model === 'folder' || node.item.model === 'workspace') {
      node.children = node.children ?? [];
      for (const item of childItems) {
        treeParentMap[item.id] = node;
        node.children.push(next({ item }));
      }
    }

    return node;
  };

  return next({
    item: activeWorkspace,
    children: [],
  });
});
