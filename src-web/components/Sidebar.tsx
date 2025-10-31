import type { Extension } from '@codemirror/state';
import { Compartment } from '@codemirror/state';
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
import { atom, useAtomValue } from 'jotai';
import { selectAtom } from 'jotai/utils';
import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useKey } from 'react-use';
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
import { Dropdown } from './core/Dropdown';
import type { FieldDef } from './core/Editor/filter/extension';
import { filter } from './core/Editor/filter/extension';
import { evaluate, parseQuery } from './core/Editor/filter/query';
import { HttpMethodTag } from './core/HttpMethodTag';
import { HttpStatusTag } from './core/HttpStatusTag';
import { Icon } from './core/Icon';
import { IconButton } from './core/IconButton';
import { InlineCode } from './core/InlineCode';
import type { InputHandle } from './core/Input';
import { Input } from './core/Input';
import { LoadingIcon } from './core/LoadingIcon';
import { collapsedFamily, isSelectedFamily } from './core/tree/atoms';
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
  const filterText = useAtomValue(sidebarFilterAtom);
  const [tree, allFields] = useAtomValue(sidebarTreeAtom) ?? [];
  const wrapperRef = useRef<HTMLElement>(null);
  const treeRef = useRef<TreeHandle>(null);
  const filterRef = useRef<InputHandle>(null);
  const allHidden = useMemo(() => {
    if (tree?.children?.length === 0) return false;
    else if (filterText) return tree?.children?.every((c) => c.hidden);
    else return true;
  }, [filterText, tree?.children]);

  const focusActiveItem = useCallback(() => {
    const didFocus = treeRef.current?.focus();
    // If we weren't able to focus any items, focus the filter bar
    if (!didFocus) filterRef.current?.focus();
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
    setTimeout(focusActiveItem, 100);
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

  // Ensure active id is always selected when it changes
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
    (e: KeyboardEvent) => {
      e.stopPropagation(); // Don't trigger tree navigation hotkeys
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
      }, 0),
    [],
  );

  // Focus the first sidebar item on arrow down from filter
  useKey('ArrowDown', (e) => {
    if (e.key === 'ArrowDown' && filterRef.current?.isFocused()) {
      e.preventDefault();
      treeRef.current?.focus();
    }
  });

  const actions = useMemo(() => {
    const enable = () => treeRef.current?.hasFocus() ?? false;

    const actions = {
      'sidebar.context_menu': {
        enable,
        cb: () => treeRef.current?.showContextMenu(),
      },
      'sidebar.expand_all': {
        enable: isSidebarFocused,
        cb: () => {
          jotaiStore.set(collapsedFamily(treeId), {});
        },
      },
      'sidebar.collapse_all': {
        enable: isSidebarFocused,
        cb: () => {
          if (tree == null) return;

          const next = (node: TreeNode<SidebarModel>, collapsed: Record<string, boolean>) => {
            for (const n of node.children ?? []) {
              if (n.item.model !== 'folder') continue;
              collapsed[n.item.id] = true;
            }
            return collapsed;
          };
          jotaiStore.set(collapsedFamily(treeId), next(tree, {}));
        },
      },
      'sidebar.selected.delete': {
        enable,
        cb: async function (items: SidebarModel[]) {
          await deleteModelWithConfirm(items);
        },
      },
      'sidebar.selected.rename': {
        enable,
        allowDefault: true,
        cb: async function (items: SidebarModel[]) {
          const item = items[0];
          if (items.length === 1 && item != null) {
            treeRef.current?.renameItem(item.id);
          }
        },
      },
      'sidebar.selected.duplicate': {
        priority: 10,
        enable,
        cb: async function (items: SidebarModel[]) {
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
        enable,
        cb: async function (items: SidebarModel[]) {
          await Promise.all(
            items
              .filter((i) => i.model === 'http_request')
              .map((i) => sendAnyHttpRequest.mutate(i.id)),
          );
        },
      },
    } as const;
    return actions;
  }, [tree, treeId]);

  const getContextMenu = useCallback<(items: SidebarModel[]) => Promise<DropdownItem[]>>(
    async (items) => {
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
          onSelect: () => actions['request.send'].cb(items),
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
            treeRef.current?.renameItem(child.id);
          },
        },
        {
          label: 'Duplicate',
          hotKeyAction: 'model.duplicate',
          hotKeyLabelOnly: true, // Would trigger for every request (bad)
          leftSlot: <Icon icon="copy" />,
          onSelect: () => actions['sidebar.selected.duplicate'].cb(items),
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
          onSelect: () => actions['sidebar.selected.delete'].cb(items),
        },
        ...modelCreationItems,
      ];
      return menuItems;
    },
    [actions],
  );

  const hotkeys = useMemo<TreeProps<SidebarModel>['hotkeys']>(() => ({ actions }), [actions]);

  // Use a language compartment for the filter so we can reconfigure it when the autocompletion changes
  const filterLanguageCompartmentRef = useRef(new Compartment());
  const filterCompartmentMountExtRef = useRef<Extension | null>(null);
  if (filterCompartmentMountExtRef.current == null) {
    filterCompartmentMountExtRef.current = filterLanguageCompartmentRef.current.of(
      filter({ fields: allFields ?? [] }),
    );
  }

  useEffect(() => {
    const view = filterRef.current;
    if (!view) return;
    const ext = filter({ fields: allFields ?? [] });
    view.dispatch({ effects: filterLanguageCompartmentRef.current.reconfigure(ext) });
  }, [allFields]);

  if (tree == null || hidden) {
    return null;
  }

  return (
    <aside
      ref={wrapperRef}
      aria-hidden={hidden ?? undefined}
      className={classNames(className, 'h-full grid grid-rows-[auto_minmax(0,1fr)_auto]')}
    >
      <div className="px-2 py-1.5 pb-0 grid grid-cols-[1fr_auto] items-center -mr-1.5">
        {(tree.children?.length ?? 0) > 0 && (
          <>
            <Input
              hideLabel
              ref={filterRef}
              size="xs"
              label="filter"
              language={null} // Explicitly disable
              containerClassName="!rounded-full px-1"
              placeholder="Search"
              onChange={handleFilterChange}
              defaultValue={filterText.text}
              forceUpdateKey={filterText.key}
              onKeyDown={handleFilterKeyDown}
              stateKey={null}
              wrapLines={false}
              extraExtensions={filterCompartmentMountExtRef.current ?? undefined}
              rightSlot={
                filterText.text && (
                  <IconButton
                    className="!h-auto min-h-full opacity-50 hover:opacity-100 -mr-1"
                    icon="x"
                    title="Clear filter"
                    onClick={clearFilterText}
                  />
                )
              }
            />
            <Dropdown
              items={[
                {
                  label: 'Expand All Folders',
                  leftSlot: <Icon icon="chevrons_up_down" />,
                  onSelect: actions['sidebar.expand_all'].cb,
                  hotKeyAction: 'sidebar.expand_all',
                  hotKeyLabelOnly: true,
                },
                {
                  label: 'Collapse All Folders',
                  leftSlot: <Icon icon="chevrons_down_up" />,
                  onSelect: actions['sidebar.collapse_all'].cb,
                  hotKeyAction: 'sidebar.collapse_all',
                  hotKeyLabelOnly: true,
                },
              ]}
            >
              <IconButton
                size="xs"
                className="ml-0.5 text-text-subtle hover:text-text"
                icon="ellipsis_vertical"
                hotkeyAction="sidebar.collapse_all"
                title="Show sidebar actions menu"
              />
            </Dropdown>
          </>
        )}
      </div>
      {allHidden ? (
        <div className="italic text-text-subtle p-3 text-sm text-center">
          No results for <InlineCode>{filterText.text}</InlineCode>
        </div>
      ) : (
        <Tree
          ref={handleTreeRefInit}
          root={tree}
          treeId={treeId}
          hotkeys={hotkeys}
          getItemKey={getItemKey}
          ItemInner={SidebarInnerItem}
          ItemLeftSlotInner={SidebarLeftSlot}
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

const sidebarTreeAtom = atom<[TreeNode<SidebarModel>, FieldDef[]] | null>((get) => {
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

  const queryAst = parseQuery(filter.text);

  // returns true if this node OR any child matches the filter
  const allFields: Record<string, Set<string>> = {};
  const build = (node: TreeNode<SidebarModel>, depth: number): boolean => {
    const childItems = childrenMap[node.item.id] ?? [];
    let matchesSelf = true;
    const fields = getItemFields(node.item);
    for (const [field, value] of Object.entries(fields)) {
      if (!value) continue;
      allFields[field] = allFields[field] ?? new Set();
      allFields[field].add(value);
    }
    if (queryAst != null) {
      matchesSelf = evaluate(queryAst, { text: getItemText(node.item), fields });
    }

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

  const fields: FieldDef[] = [];
  for (const [name, values] of Object.entries(allFields)) {
    fields.push({ name, values: Array.from(values).filter((v) => v.length < 20) });
  }
  return [root, fields] as const;
});

function getItemKey(item: SidebarModel) {
  const responses = jotaiStore.get(httpResponsesAtom);
  const latestResponse = responses.find((r) => r.requestId === item.id) ?? null;
  const url = 'url' in item ? item.url : 'n/a';
  const method = 'method' in item ? item.method : 'n/a';
  const service = 'service' in item ? item.service : 'n/a';
  return [
    item.id,
    item.name,
    url,
    method,
    service,
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
        className={classNames('text-xs pl-1.5', !isSelected && OPACITY_SUBTLE)}
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

function getItemFields(item: SidebarModel): Record<string, string> {
  if (item.model === 'workspace') return {};

  const fields: Record<string, string> = {};
  if (item.model === 'http_request') {
    fields.method = item.method.toUpperCase();
  }

  if (item.model === 'grpc_request') {
    fields.grpc_method = item.method ?? '';
    fields.grpc_service = item.service ?? '';
  }

  if ('url' in item) fields.url = item.url;
  fields.name = resolvedModelName(item);

  fields.type = 'http';
  if (item.model === 'grpc_request') fields.type = 'grpc';
  else if (item.model === 'websocket_request') fields.type = 'ws';

  return fields;
}

function getItemText(item: SidebarModel): string {
  return resolvedModelName(item);
}
