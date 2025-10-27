import { debounce } from '@yaakapp-internal/lib';
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
import { fuzzyMatch } from 'fuzzbunny';
import { atom, useAtomValue } from 'jotai';
import { selectAtom } from 'jotai/utils';
import type { KeyboardEvent } from 'react';
import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { moveToWorkspace } from '../commands/moveToWorkspace';
import { openFolderSettings } from '../commands/openFolderSettings';
import { activeCookieJarAtom } from '../hooks/useActiveCookieJar';
import { activeEnvironmentAtom } from '../hooks/useActiveEnvironment';
import { activeFolderIdAtom } from '../hooks/useActiveFolderId';
import { activeRequestIdAtom } from '../hooks/useActiveRequestId';
import { activeWorkspaceAtom, activeWorkspaceIdAtom } from '../hooks/useActiveWorkspace';
import { allRequestsAtom } from '../hooks/useAllRequests';
import { getCreateDropdownItems } from '../hooks/useCreateDropdownItems';
import { getGrpcRequestActions } from '../hooks/useGrpcRequestActions';
import { useHotKey } from '../hooks/useHotKey';
import { getHttpRequestActions } from '../hooks/useHttpRequestActions';
import { sendAnyHttpRequest } from '../hooks/useSendAnyHttpRequest';
import { useSidebarHidden } from '../hooks/useSidebarHidden';
import { deepEqualAtom } from '../lib/atoms';
import { deleteModelWithConfirm } from '../lib/deleteModelWithConfirm';
import { jotaiStore } from '../lib/jotai';
import { resolvedModelName } from '../lib/resolvedModelName';
import { isSidebarFocused } from '../lib/scopes';
import { navigateToRequestOrFolderOrWorkspace } from '../lib/setWorkspaceSearchParams';
import { invokeCmd } from '../lib/tauri';
import type { ContextMenuProps, DropdownItem } from './core/Dropdown';
import { HttpMethodTag } from './core/HttpMethodTag';
import { HttpStatusTag } from './core/HttpStatusTag';
import { Icon } from './core/Icon';
import { IconButton } from './core/IconButton';
import { InlineCode } from './core/InlineCode';
import { LoadingIcon } from './core/LoadingIcon';
import { PlainInput } from './core/PlainInput';
import { isSelectedFamily } from './core/tree/atoms';
import type { TreeNode } from './core/tree/common';
import type { TreeHandle, TreeProps } from './core/tree/Tree';
import { Tree } from './core/tree/Tree';
import type { TreeItemProps } from './core/tree/TreeItem';
import { GitDropdown } from './GitDropdown';

type SidebarModel = Workspace | Folder | HttpRequest | GrpcRequest | WebsocketRequest;

const OPACITY_SUBTLE = 'opacity-80';

function Sidebar({ className }: { className?: string }) {
  const [hidden, setHidden] = useSidebarHidden();
  const activeWorkspaceId = useAtomValue(activeWorkspaceAtom)?.id;
  const treeId = 'tree.' + (activeWorkspaceId ?? 'unknown');
  const filter = useAtomValue(sidebarFilterAtom);
  const tree = useAtomValue(sidebarTreeAtom);
  const wrapperRef = useRef<HTMLElement>(null);
  const treeRef = useRef<TreeHandle>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const allHidden = useMemo(() => {
    if (tree?.children?.length === 0) return false;
    else if (filter) return false;
    else return tree?.children?.every((c) => c.hidden);
  }, [filter, tree?.children]);

  const focusActiveItem = useCallback(() => {
    treeRef.current?.focus();
  }, []);

  useHotKey(
    'sidebar.filter',
    () => {
      filterRef.current?.focus();
    },
    {
      enable: isSidebarFocused,
    },
  );

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
    items: SidebarModel[];
    parent: SidebarModel;
    children: SidebarModel[];
    insertAt: number;
  }) {
    const prev = children[insertAt - 1] as Exclude<SidebarModel, Workspace>;
    const next = children[insertAt] as Exclude<SidebarModel, Workspace>;
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

  const clearFilterText = useCallback(() => {
    jotaiStore.set(sidebarFilterAtom, { text: '', key: `${Math.random()}` });
    requestAnimationFrame(() => {
      filterRef.current?.focus();
    });
  }, []);

  const handleFilterKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        clearFilterText();
      }
    },
    [clearFilterText],
  );

  const handleFilterChange = useMemo(
    () =>
      debounce((text: string) => {
        jotaiStore.set(sidebarFilterAtom, (prev) => ({ ...prev, text }));
      }, 200),
    [],
  );

  if (tree == null || hidden) {
    return null;
  }

  return (
    <aside
      ref={wrapperRef}
      aria-hidden={hidden ?? undefined}
      className={classNames(className, 'h-full grid grid-rows-[auto_minmax(0,1fr)_auto]')}
    >
      <div className="px-2 py-1.5 pb-0">
        {(tree.children?.length ?? 0) > 0 && (
          <PlainInput
            hideLabel
            ref={filterRef}
            size="xs"
            label="filter"
            containerClassName="!rounded-full px-1"
            placeholder="Search"
            onChange={handleFilterChange}
            defaultValue={filter.text}
            forceUpdateKey={filter.key}
            onKeyDownCapture={handleFilterKeyDown}
            rightSlot={
              filter.text && (
                <IconButton
                  color="custom"
                  className="!h-auto min-h-full opacity-50 hover:opacity-100 -mr-1.5"
                  icon="x"
                  title="Clear filter"
                  onClick={() => {
                    clearFilterText();
                  }}
                />
              )
            }
          />
        )}
      </div>
      {allHidden ? (
        <div className="italic text-text-subtle p-3 mt-2 text-sm text-center">
          No results for <InlineCode>{filter.text}</InlineCode>
        </div>
      ) : (
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
      )}
      <GitDropdown />
    </aside>
  );
}

export default Sidebar;

const activeIdAtom = atom<string | null>((get) => {
  return get(activeRequestIdAtom) || get(activeFolderIdAtom);
});

function getEditOptions(
  item: SidebarModel,
): ReturnType<NonNullable<TreeItemProps<SidebarModel>['getEditOptions']>> {
  return {
    onChange: handleSubmitEdit,
    defaultValue: resolvedModelName(item),
    placeholder: item.name,
  };
}

async function handleSubmitEdit(item: SidebarModel, text: string) {
  await patchModel(item, { name: text });
}

function handleActivate(item: SidebarModel) {
  // TODO: Add folder layout support
  if (item.model !== 'folder' && item.model !== 'workspace') {
    navigateToRequestOrFolderOrWorkspace(item.id, item.model);
  }
}

const allPotentialChildrenAtom = atom<SidebarModel[]>((get) => {
  const requests = get(allRequestsAtom);
  const folders = get(foldersAtom);
  return [...requests, ...folders];
});

const memoAllPotentialChildrenAtom = deepEqualAtom(allPotentialChildrenAtom);

const sidebarFilterAtom = atom<{ text: string; key: string }>({ text: '', key: '' });

const sidebarTreeAtom = atom<TreeNode<SidebarModel> | null>((get) => {
  const allModels = get(memoAllPotentialChildrenAtom);
  const activeWorkspace = get(activeWorkspaceAtom);
  const filter = get(sidebarFilterAtom);

  const childrenMap: Record<string, Exclude<SidebarModel, Workspace>[]> = {};
  for (const item of allModels) {
    if ('folderId' in item && item.folderId == null) {
      childrenMap[item.workspaceId] = childrenMap[item.workspaceId] ?? [];
      childrenMap[item.workspaceId]!.push(item);
    } else if ('folderId' in item && item.folderId != null) {
      childrenMap[item.folderId] = childrenMap[item.folderId] ?? [];
      childrenMap[item.folderId]!.push(item);
    }
  }

  if (activeWorkspace == null) {
    return null;
  }

  // returns true if this node OR any child matches the filter
  const build = (node: TreeNode<SidebarModel>, depth: number): boolean => {
    const childItems = childrenMap[node.item.id] ?? [];
    const matchesSelf = !filter || fuzzyMatch(resolvedModelName(node.item), filter.text) != null;

    let matchesChild = false;

    // Recurse to children
    const m = node.item.model;
    node.children = m === 'folder' || m === 'workspace' ? [] : undefined;

    if (node.children != null) {
      childItems.sort((a, b) => {
        if (a.sortPriority === b.sortPriority) {
          return a.updatedAt > b.updatedAt ? 1 : -1;
        }
        return a.sortPriority - b.sortPriority;
      });

      for (const item of childItems) {
        const childNode = { item, parent: node, depth };
        const childMatches = build(childNode, depth + 1);
        if (childMatches) {
          matchesChild = true;
        }
        node.children.push(childNode);
      }
    }

    // hide node IFF nothing in its subtree matches
    const anyMatch = matchesSelf || matchesChild;
    node.hidden = !anyMatch;

    return anyMatch;
  };

  const root: TreeNode<SidebarModel> = {
    item: activeWorkspace,
    parent: null,
    children: [],
    depth: 0,
  };

  // Build tree and mark visibility in one pass
  build(root, 1);

  return root;
});

const actions = {
  'sidebar.selected.delete': {
    enable: isSidebarFocused,
    cb: async function (_: TreeHandle, items: SidebarModel[]) {
      await deleteModelWithConfirm(items);
    },
  },
  'sidebar.selected.rename': {
    enable: isSidebarFocused,
    allowDefault: true,
    cb: async function (tree: TreeHandle, items: SidebarModel[]) {
      const item = items[0];
      if (items.length === 1 && item != null) {
        tree.renameItem(item.id);
      }
    },
  },
  'sidebar.selected.duplicate': {
    priority: 999,
    enable: isSidebarFocused,
    cb: async function (_: TreeHandle, items: SidebarModel[]) {
      if (items.length === 1) {
        const item = items[0]!;
        const newId = await duplicateModel(item);
        navigateToRequestOrFolderOrWorkspace(newId, item.model);
      } else {
        await Promise.all(items.map(duplicateModel));
      }
    },
  },
  'request.send': {
    enable: isSidebarFocused,
    cb: async function (_: TreeHandle, items: SidebarModel[]) {
      await Promise.all(
        items.filter((i) => i.model === 'http_request').map((i) => sendAnyHttpRequest.mutate(i.id)),
      );
    },
  },
} as const;

const hotkeys: TreeProps<SidebarModel>['hotkeys'] = { actions };

async function getContextMenu(tree: TreeHandle, items: SidebarModel[]): Promise<DropdownItem[]> {
  const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
  const child = items[0];

  // No children means we're in the root
  if (child == null) {
    return getCreateDropdownItems({ workspaceId, activeRequest: null, folderId: null });
  }

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
      onSelect: () => actions['request.send'].cb(tree, items),
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
  const modelCreationItems: DropdownItem[] =
    items.length === 1 && child.model === 'folder'
      ? [
          { type: 'separator' },
          ...getCreateDropdownItems({ workspaceId, activeRequest: null, folderId: child.id }),
        ]
      : [];
  const menuItems: ContextMenuProps['items'] = [
    ...initialItems,
    { type: 'separator', hidden: initialItems.filter((v) => !v.hidden).length === 0 },
    {
      label: 'Rename',
      leftSlot: <Icon icon="pencil" />,
      hidden: items.length > 1,
      hotKeyAction: 'sidebar.selected.rename',
      hotKeyLabelOnly: true,
      onSelect: () => {
        tree.renameItem(child.id);
      },
    },
    {
      label: 'Duplicate',
      hotKeyAction: 'model.duplicate',
      hotKeyLabelOnly: true, // Would trigger for every request (bad)
      leftSlot: <Icon icon="copy" />,
      onSelect: () => actions['sidebar.selected.duplicate'].cb(tree, items),
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
      hotKeyAction: 'sidebar.selected.delete',
      hotKeyLabelOnly: true,
      leftSlot: <Icon icon="trash" />,
      onSelect: () => actions['sidebar.selected.delete'].cb(tree, items),
    },
    ...modelCreationItems,
  ];
  return menuItems;
}

function getItemKey(item: SidebarModel) {
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

const SidebarLeftSlot = memo(function SidebarLeftSlot({
  treeId,
  item,
}: {
  treeId: string;
  item: SidebarModel;
}) {
  if (item.model === 'folder') {
    return <Icon icon="folder" />;
  } else if (item.model === 'workspace') {
    return null;
  } else {
    const isSelected = jotaiStore.get(isSelectedFamily({ treeId, itemId: item.id }));
    return (
      <HttpMethodTag
        short
        className={classNames('text-xs', !isSelected && OPACITY_SUBTLE)}
        request={item}
      />
    );
  }
});

const SidebarInnerItem = memo(function SidebarInnerItem({
  item,
}: {
  treeId: string;
  item: SidebarModel;
}) {
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
});
