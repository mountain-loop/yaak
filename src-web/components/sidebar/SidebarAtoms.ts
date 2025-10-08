import type { Folder, GrpcRequest, HttpRequest, WebsocketRequest } from '@yaakapp-internal/models';
import { foldersAtom } from '@yaakapp-internal/models';

// This is an atom, so we can use it in the child items to avoid re-rendering the entire list
import { atom } from 'jotai';
import { activeFolderAtom } from '../../hooks/useActiveFolder';
import { activeRequestAtom } from '../../hooks/useActiveRequest';
import { activeWorkspaceAtom } from '../../hooks/useActiveWorkspace';
import { allRequestsAtom } from '../../hooks/useAllRequests';
import { sidebarCollapsedAtom } from '../../hooks/useSidebarItemCollapsed';
import { deepEqualAtom } from '../../lib/atoms';
import { resolvedModelName } from '../../lib/resolvedModelName';
import type { SidebarTreeNode } from './Sidebar';

type SidebarModel = Folder | HttpRequest | GrpcRequest | WebsocketRequest;
type SidebarChild = Pick<
  SidebarModel,
  'id' | 'model' | 'folderId' | 'name' | 'workspaceId' | 'sortPriority'
>;

export const sidebarHasFocusAtom = atom<boolean>(false);
export const sidebarSelectedIdAtom = atom<string | null>(null);
export const sidebarActiveIdAtom = atom<string | null>((get) => {
  return get(sidebarActiveItemAtom)?.id ?? null;
});
export const sidebarActiveItemAtom = atom<SidebarModel | null>((get) => {
  const activeRequest = get(activeRequestAtom);
  const activeFolder = get(activeFolderAtom);
  return activeRequest ?? activeFolder ?? null;
});

const allPotentialChildrenAtom = atom<SidebarChild[]>((get) => {
  const requests = get(allRequestsAtom);
  const folders = get(foldersAtom);
  return [...requests, ...folders].map((v) => ({
    id: v.id,
    model: v.model,
    folderId: v.folderId,
    name: resolvedModelName(v),
    workspaceId: v.workspaceId,
    sortPriority: v.sortPriority,
  }));
});

const memoAllPotentialChildrenAtom = deepEqualAtom(allPotentialChildrenAtom);

interface SelectableItem {
  id: SidebarChild['id'];
  model: SidebarChild['model'];
  index: number;
  tree: SidebarTreeNode;
  depth: number;
}

export const sidebarTreeAtom = atom<{
  tree: SidebarTreeNode | null;
  treeParentMap: Record<string, SidebarTreeNode>;
  selectableItems: SelectableItem[];
}>((get) => {
  const collapsedMap = get(get(sidebarCollapsedAtom));
  const allModels = get(memoAllPotentialChildrenAtom);
  const activeWorkspace = get(activeWorkspaceAtom);

  const childrenMap: Record<string, SidebarChild[]> = {};
  for (const item of allModels) {
    if ('folderId' in item && item.folderId == null) {
      childrenMap[item.workspaceId] = childrenMap[item.workspaceId] ?? [];
      childrenMap[item.workspaceId]!.push(item);
    } else if ('folderId' in item && item.folderId != null) {
      childrenMap[item.folderId] = childrenMap[item.folderId] ?? [];
      childrenMap[item.folderId]!.push(item);
    }
  }

  const treeParentMap: Record<string, SidebarTreeNode> = {};
  const selectableItems: SelectableItem[] = [];

  if (activeWorkspace == null) {
    return { tree: null, treeParentMap, selectableItems };
  }

  const selectedItem: Folder | HttpRequest | GrpcRequest | WebsocketRequest | null = null;
  let selectableIndex = 0;

  // Put requests and folders into a tree structure
  const next = (node: SidebarTreeNode): SidebarTreeNode => {
    const isCollapsed = collapsedMap[node.id] === true;
    const childItems = childrenMap[node.id] ?? [];

    // Recurse to children
    const depth = node.depth + 1;
    childItems.sort((a, b) => a.sortPriority - b.sortPriority);
    for (const childItem of childItems) {
      treeParentMap[childItem.id] = node;
      if (!isCollapsed) {
        selectableItems.push({
          id: childItem.id,
          model: childItem.model,
          index: selectableIndex++,
          tree: node,
          depth,
        });
      }

      node.children.push(next(itemFromModel(childItem, depth)));
    }

    return node;
  };

  const tree = next({
    id: activeWorkspace.id,
    name: activeWorkspace.name,
    model: activeWorkspace.model,
    children: [],
    depth: 0,
  });

  return {
    tree,
    treeParentMap,
    selectableItems,
    selectedItem,
  };
});

function itemFromModel(
  item: Pick<
    Folder | HttpRequest | GrpcRequest | WebsocketRequest,
    'folderId' | 'model' | 'workspaceId' | 'id' | 'name' | 'sortPriority'
  >,
  depth = 0,
): SidebarTreeNode {
  return {
    id: item.id,
    name: item.name,
    model: item.model,
    sortPriority: 'sortPriority' in item ? item.sortPriority : -1,
    workspaceId: item.workspaceId,
    folderId: item.folderId,
    depth,
    children: [],
  };
}
