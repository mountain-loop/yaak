import type {
  Folder,
  GrpcRequest,
  HttpRequest,
  WebsocketRequest,
  Workspace,
} from '@yaakapp-internal/models';
import {
  foldersAtom,
  getModel,
  httpResponsesAtom,
  patchModel,
  workspacesAtom,
} from '@yaakapp-internal/models';
import classNames from 'classnames';
import { atom, useAtomValue } from 'jotai';
import { selectAtom } from 'jotai/utils';
import React, { useCallback, useMemo, useRef } from 'react';
import { openFolderSettings } from '../commands/openFolderSettings';
import { activeFolderIdAtom } from '../hooks/useActiveFolderId';
import { activeRequestIdAtom } from '../hooks/useActiveRequestId';
import { activeWorkspaceAtom } from '../hooks/useActiveWorkspace';
import { allRequestsAtom } from '../hooks/useAllRequests';
import { getGrpcRequestActions } from '../hooks/useGrpcRequestActions';
import { useHotKey } from '../hooks/useHotKey';
import { getHttpRequestActions } from '../hooks/useHttpRequestActions';
import { sendAnyHttpRequest } from '../hooks/useSendAnyHttpRequest';
import { useSidebarHidden } from '../hooks/useSidebarHidden';
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
import { focusIdsFamily, isSelectedFamily } from './core/tree/atoms';
import type { TreeNode } from './core/tree/common';
import type { TreeHandle } from './core/tree/Tree';
import { Tree } from './core/tree/Tree';
import type { TreeItemProps } from './core/tree/TreeItem';
import { GitDropdown } from './GitDropdown';

type Model = Workspace | Folder | HttpRequest | GrpcRequest | WebsocketRequest;

const opacitySubtle = 'opacity-80';

function getItemKey(item: Model) {
  const responses = jotaiStore.get(httpResponsesAtom);
  const latestResponse = responses.find((r) => r.requestId === item.id) ?? null;
  const url = 'url' in item ? item.url : 'n/a';
  console.log('LATEST', latestResponse?.elapsed);
  return [item.id, item.name, url, latestResponse?.elapsed, latestResponse?.id ?? 'n/a'].join('::');
}

function SidebarItem(item: Model) {
  const response = useAtomValue(
    useMemo(
      () =>
        selectAtom(
          httpResponsesAtom,
          (responses) => responses.find((r) => r.requestId === item.id),
          (a, b) => a?.state === b?.state, // Only update when the response state changes updated
        ),
      [item.id],
    ),
  );

  return (
    <div className="flex items-center gap-2 min-w-0 h-full w-full text-left">
      <div className="truncate">{resolvedModelName(item)}</div>
      {response != null && (
        <div className="ml-auto">
          {response.state !== 'closed' ? (
            <LoadingIcon size="sm" className="text-text-subtlest" />
          ) : (
            <HttpStatusTag short className="text-xs" response={response} />
          )}
        </div>
      )}
    </div>
  );
}

function NewSidebar({ className }: { className?: string }) {
  const [hidden, setHidden] = useSidebarHidden();
  const tree = useAtomValue(sidebarTreeAtom);
  const treeId = 'workspace.sidebar';
  const wrapperRef = useRef<HTMLElement>(null);
  const treeRef = useRef<TreeHandle>(null);

  const renderLeftSlot = useCallback(function renderLeftSlot(item: Model) {
    if (item.model === 'folder') {
      return <Icon icon="folder" />;
    } else if (item.model === 'workspace') {
      return null;
    } else {
      const isSelected = jotaiStore.get(isSelectedFamily({ treeId, itemId: item.id }));
      return (
        <HttpMethodTag
          short
          className={classNames('text-xs', !isSelected && opacitySubtle)}
          request={item}
        />
      );
    }
  }, []);

  const renderItem = SidebarItem;

  // const renderItem = useCallback(function renderItem(item: Model) {
  //   const responses = jotaiStore.get(httpResponsesAtom);
  //   const latestHttpResponse = responses.find((r) => r.requestId === item.id) ?? null;
  //   return (
  //     <div className="flex items-center gap-2 min-w-0 h-full w-full text-left">
  //       <div className="truncate">{resolvedModelName(item)}</div>
  //       {latestHttpResponse && (
  //         <div className="ml-auto">
  //           {latestHttpResponse.state !== 'closed' ? (
  //             <LoadingIcon size="sm" className="text-text-subtlest" />
  //           ) : (
  //             <HttpStatusTagForResponse short className="text-xs" responseId={latestHttpResponse.id} />
  //           )}
  //         </div>
  //       )}
  //     </div>
  //   );
  // }, []);

  const focusActiveItem = useCallback(() => {
    treeRef.current?.focus();
  }, []);

  useHotKey('http_request.duplicate', async () => {
    const lastFocused = jotaiStore.get(focusIdsFamily(treeId)).lastId;
    const activeId = jotaiStore.get(activeIdAtom);
    const toFocus = lastFocused ?? activeId;
    const model = toFocus
      ? getModel(['http_request', 'websocket_request', 'grpc_request', 'folder'], toFocus)
      : null;
    if (model != null) {
      await duplicateRequestOrFolderAndNavigate(model);
    }
  });

  useHotKey('sidebar.focus', async function focusHotkey() {
    // Hide the sidebar if it's already focused
    if (!hidden && wrapperRef.current?.contains(document.activeElement)) {
      await setHidden(true);
      return;
    }

    // Show the sidebar if it's hidden
    if (hidden) {
      await setHidden(false);
    }

    // Select the 0th index on focus if none selected
    focusActiveItem();
  });

  const handleDragEnd = useCallback(async function handleDragEnd({
    items,
    parent,
    children,
    insertAt,
  }: {
    items: Model[];
    parent: Model;
    children: Model[];
    insertAt: number;
  }) {
    const prev = children[insertAt - 1] as Exclude<Model, Workspace>;
    const next = children[insertAt] as Exclude<Model, Workspace>;
    const folderId = parent.model === 'folder' ? parent.id : null;

    const beforePriority = prev?.sortPriority ?? 0;
    const afterPriority = next?.sortPriority ?? 0;
    const shouldUpdateAll = afterPriority - beforePriority < 1;

    try {
      if (shouldUpdateAll) {
        // Add items to children at insertAt
        children.splice(insertAt, 0, ...items);
        await Promise.allSettled(
          children.map((m, i) => patchModel(m, { sortPriority: i * 1000, folderId })),
        );
      } else {
        const range = afterPriority - beforePriority;
        const increment = range / (items.length + 2);
        await Promise.allSettled(
          items.map((m, i) =>
            // Spread item sortPriority out over before/after range
            patchModel(m, { sortPriority: beforePriority + (i + 1) * increment, folderId }),
          ),
        );
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const handleTreeRefInit = useCallback((n: TreeHandle) => {
    treeRef.current = n;
    if (n == null) return;
    const activeId = jotaiStore.get(activeIdAtom);
    if (activeId == null) return;
    n.selectItem(activeId);
  }, []);

  if (tree == null || hidden) {
    return null;
  }

  return (
    <aside
      ref={wrapperRef}
      aria-hidden={hidden ?? undefined}
      className={classNames(className, 'h-full grid grid-rows-[minmax(0,1fr)_auto]')}
    >
      <Tree
        ref={handleTreeRefInit}
        root={tree}
        treeId={treeId}
        getItemKey={getItemKey}
        renderItem={renderItem}
        renderLeftSlot={renderLeftSlot}
        getContextMenu={getContextMenu}
        onActivate={handleActivate}
        getEditOptions={getEditOptions}
        className="pl-0.5 pr-3 pt-2 pb-2"
        onDragEnd={handleDragEnd}
      />
      <GitDropdown />
    </aside>
  );
}

export default NewSidebar;

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

async function getContextMenu(items: Model[]): Promise<ContextMenuProps['items']> {
  const child = items[0];
  if (child == null) return [];

  const workspaces = jotaiStore.get(workspacesAtom);

  const initialItems: ContextMenuProps['items'] = [
    {
      label: 'Folder Settings',
      hidden: !(items.length === 1 && child.model === 'folder'),
      leftSlot: <Icon icon="folder_cog" />,
      onSelect: () => openFolderSettings(child.id),
    },
    {
      label: 'Send All',
      hidden: !(items.length === 1 && child.model === 'folder'),
      leftSlot: <Icon icon="send_horizontal" />,
      onSelect: () => {
        for (const item of items) {
          sendAnyHttpRequest.mutate(item.id);
        }
      },
    },
    {
      label: 'Send',
      hotKeyAction: 'http_request.send',
      hotKeyLabelOnly: true, // Already bound in URL bar
      hidden: !(items.length === 1 && child.model === 'http_request'),
      leftSlot: <Icon icon="send_horizontal" />,
      onSelect: () => sendAnyHttpRequest.mutate(child.id),
    },
    ...(items.length === 1 && child.model === 'http_request'
      ? await getHttpRequestActions()
      : []
    ).map((a) => ({
      label: a.label,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      leftSlot: <Icon icon={(a.icon as any) ?? 'empty'} />,
      onSelect: async () => {
        const request = getModel('http_request', child.id);
        if (request != null) await a.call(request);
      },
    })),
    ...(items.length === 1 && child.model === 'grpc_request'
      ? await getGrpcRequestActions()
      : []
    ).map((a) => ({
      label: a.label,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      leftSlot: <Icon icon={(a.icon as any) ?? 'empty'} />,
      onSelect: async () => {
        const request = getModel('grpc_request', child.id);
        if (request != null) await a.call(request);
      },
    })),
  ];

  const menuItems: ContextMenuProps['items'] = [
    ...initialItems,
    { type: 'separator', hidden: initialItems.filter(v => !v.hidden).length === 0 },
    {
      label: 'Rename',
      leftSlot: <Icon icon="pencil" />,
      hidden: items.length > 1,
      onSelect: async () => {
        const request = getModel(
          ['folder', 'http_request', 'grpc_request', 'websocket_request'],
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
        node.children.push(next({ item, parent: node }));
      }
    }

    return node;
  };

  return next({
    item: activeWorkspace,
    children: [],
    parent: null,
  });
});
