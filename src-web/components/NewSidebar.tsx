import type {
  Folder,
  GrpcRequest,
  HttpRequest,
  WebsocketRequest,
  Workspace,
} from '@yaakapp-internal/models';
import {
  duplicateModel,
  foldersAtom,
  getModel,
  grpcConnectionsAtom,
  httpResponsesAtom,
  patchModel,
  websocketConnectionsAtom,
  workspacesAtom,
} from '@yaakapp-internal/models';
import classNames from 'classnames';
import { atom, useAtomValue } from 'jotai';
import { selectAtom } from 'jotai/utils';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { moveToWorkspace } from '../commands/moveToWorkspace';
import { openFolderSettings } from '../commands/openFolderSettings';
import { activeCookieJarAtom } from '../hooks/useActiveCookieJar';
import { activeEnvironmentAtom } from '../hooks/useActiveEnvironment';
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
import { jotaiStore } from '../lib/jotai';
import { renameModelWithPrompt } from '../lib/renameModelWithPrompt';
import { resolvedModelName } from '../lib/resolvedModelName';
import { isSidebarFocused } from '../lib/scopes';
import { navigateToRequestOrFolderOrWorkspace } from '../lib/setWorkspaceSearchParams';
import { invokeCmd } from '../lib/tauri';
import type { ContextMenuProps, DropdownItem } from './core/Dropdown';
import { HttpMethodTag } from './core/HttpMethodTag';
import { HttpStatusTag } from './core/HttpStatusTag';
import { Icon } from './core/Icon';
import { LoadingIcon } from './core/LoadingIcon';
import { isSelectedFamily } from './core/tree/atoms';
import type { TreeNode } from './core/tree/common';
import type { TreeHandle, TreeProps } from './core/tree/Tree';
import { Tree } from './core/tree/Tree';
import type { TreeItemProps } from './core/tree/TreeItem';
import { GitDropdown } from './GitDropdown';

type Model = Workspace | Folder | HttpRequest | GrpcRequest | WebsocketRequest;

const opacitySubtle = 'opacity-80';

function getItemKey(item: Model) {
  const responses = jotaiStore.get(httpResponsesAtom);
  const latestResponse = responses.find((r) => r.requestId === item.id) ?? null;
  const url = 'url' in item ? item.url : 'n/a';
  const method = 'method' in item ? item.method : 'n/a';
  return [
    item.id,
    item.name,
    url,
    method,
    latestResponse?.elapsed,
    latestResponse?.id ?? 'n/a',
  ].join('::');
}

function SidebarLeftSlot({ treeId, item }: { treeId: string; item: Model }) {
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
}

function SidebarInnerItem({ item }: { treeId: string; item: Model }) {
  const response = useAtomValue(
    useMemo(
      () =>
        selectAtom(
          atom((get) => [
            ...get(grpcConnectionsAtom),
            ...get(httpResponsesAtom),
            ...get(websocketConnectionsAtom),
          ]),
          (responses) => responses.find((r) => r.requestId === item.id),
          (a, b) => a?.state === b?.state && a?.id === b?.id, // Only update when the response state changes updated
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
          ) : response.model === 'http_response' ? (
            <HttpStatusTag short className="text-xs" response={response} />
          ) : null}
        </div>
      )}
    </div>
  );
}

function NewSidebar({ className }: { className?: string }) {
  const [hidden, setHidden] = useSidebarHidden();
  const tree = useAtomValue(sidebarTreeAtom);
  const activeWorkspaceId = useAtomValue(activeWorkspaceAtom)?.id;
  const treeId = 'tree.' + (activeWorkspaceId ?? 'unknown');
  const wrapperRef = useRef<HTMLElement>(null);
  const treeRef = useRef<TreeHandle>(null);

  const focusActiveItem = useCallback(() => {
    treeRef.current?.focus();
  }, []);

  useHotKey('sidebar.focus', async function focusHotkey() {
    // Hide the sidebar if it's already focused
    if (!hidden && isSidebarFocused()) {
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
        await Promise.all(
          children.map((m, i) => patchModel(m, { sortPriority: i * 1000, folderId })),
        );
      } else {
        const range = afterPriority - beforePriority;
        const increment = range / (items.length + 2);
        await Promise.all(
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

  useEffect(() => {
    return jotaiStore.sub(activeIdAtom, () => {
      const activeId = jotaiStore.get(activeIdAtom);
      if (activeId == null) return;
      treeRef.current?.selectItem(activeId);
    });
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
        hotkeys={hotkeys}
        getItemKey={getItemKey}
        ItemInner={SidebarInnerItem}
        ItemLeftSlot={SidebarLeftSlot}
        getContextMenu={getContextMenu}
        onActivate={handleActivate}
        getEditOptions={getEditOptions}
        className="pl-2 pr-3 pt-2 pb-2"
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

function handleActivate(item: Model) {
  // TODO: Add folder layout support
  if (item.model !== 'folder' && item.model !== 'workspace') {
    navigateToRequestOrFolderOrWorkspace(item.id, item.model);
  }
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

const actions = {
  'sidebar.delete_selected_item': async function (items: Model[]) {
    await deleteModelWithConfirm(items);
  },
  'model.duplicate': async function (items: Model[]) {
    if (items.length === 1) {
      const item = items[0]!;
      const newId = await duplicateModel(item);
      navigateToRequestOrFolderOrWorkspace(newId, item.model);
    } else {
      await Promise.all(items.map(duplicateModel));
    }
  },
  'request.send': async function (items: Model[]) {
    await Promise.all(
      items.filter((i) => i.model === 'http_request').map((i) => sendAnyHttpRequest.mutate(i.id)),
    );
  },
} as const;

const hotkeys: TreeProps<Model>['hotkeys'] = {
  priority: 10, // So these ones take precedence over global hotkeys when the sidebar is focused
  actions,
  enable: () => isSidebarFocused(),
};

async function getContextMenu(items: Model[]): Promise<DropdownItem[]> {
  const child = items[0];
  if (child == null) return [];
  const workspaces = jotaiStore.get(workspacesAtom);
  const onlyHttpRequests = items.every((i) => i.model === 'http_request');

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
        const environment = jotaiStore.get(activeEnvironmentAtom);
        const cookieJar = jotaiStore.get(activeCookieJarAtom);
        invokeCmd('cmd_send_folder', {
          folderId: child.id,
          environmentId: environment?.id,
          cookieJarId: cookieJar?.id,
        });
      },
    },
    {
      label: 'Send',
      hotKeyAction: 'request.send',
      hotKeyLabelOnly: true,
      hidden: !onlyHttpRequests,
      leftSlot: <Icon icon="send_horizontal" />,
      onSelect: () => actions['request.send'](items),
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
    { type: 'separator', hidden: initialItems.filter((v) => !v.hidden).length === 0 },
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
      hotKeyAction: 'model.duplicate',
      hotKeyLabelOnly: true, // Would trigger for every request (bad)
      leftSlot: <Icon icon="copy" />,
      onSelect: () => actions['model.duplicate'](items),
    },
    {
      label: 'Move',
      leftSlot: <Icon icon="arrow_right_circle" />,
      hidden:
        workspaces.length <= 1 ||
        items.length > 1 ||
        child.model === 'folder' ||
        child.model === 'workspace',
      onSelect: () => {
        if (child.model === 'folder' || child.model === 'workspace') return;
        moveToWorkspace.mutate(child);
      },
    },
    {
      color: 'danger',
      label: 'Delete',
      hotKeyAction: 'sidebar.delete_selected_item',
      hotKeyLabelOnly: true,
      leftSlot: <Icon icon="trash" />,
      onSelect: () => actions['sidebar.delete_selected_item'](items),
    },
  ];
  return menuItems;
}
