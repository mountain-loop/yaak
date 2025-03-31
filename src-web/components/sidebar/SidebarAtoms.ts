import {
  type Folder,
  foldersAtom,
  type GrpcRequest,
  type HttpRequest,
  type WebsocketRequest,
} from '@yaakapp-internal/models';

// This is an atom so we can use it in the child items to avoid re-rendering the entire list
import { atom } from 'jotai';
import { activeWorkspaceAtom } from '../../hooks/useActiveWorkspace';
import { allRequestsAtom } from '../../hooks/useAllRequests';
import { deepEqualAtom } from '../../lib/atoms';
import { resolvedModelName } from '../../lib/resolvedModelName';
import type { SidebarTreeNode } from './Sidebar';

export const sidebarSelectedIdAtom = atom<string | null>(null);

const allPotentialChildrenAtom = atom((get) => {
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

export const sidebarTreeAtom = atom<{
  tree: SidebarTreeNode | null;
  treeParentMap: Record<string, SidebarTreeNode>;
  selectableRequests: {
    id: string;
    index: number;
    tree: SidebarTreeNode;
  }[];
}>((get) => {
  const allModels = get(memoAllPotentialChildrenAtom);
  const activeWorkspace = get(activeWorkspaceAtom);

  const childrenMap: Record<string, typeof allModels> = {};
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
  const selectableRequests: {
    id: string;
    index: number;
    tree: SidebarTreeNode;
  }[] = [];

  if (activeWorkspace == null) {
    return { tree: null, treeParentMap, selectableRequests };
  }

  const selectedRequest: HttpRequest | GrpcRequest | WebsocketRequest | null = null;
  let selectableRequestIndex = 0;

  // Put requests and folders into a tree structure
  const next = (node: SidebarTreeNode): SidebarTreeNode => {
    const childItems = childrenMap[node.id] ?? [];

    // Recurse to children
    const depth = node.depth + 1;
    childItems.sort((a, b) => a.sortPriority - b.sortPriority);
    for (const childItem of childItems) {
      treeParentMap[childItem.id] = node;
      // Add to children
      node.children.push(next(itemFromModel(childItem, depth)));
      // Add to selectable requests
      if (childItem.model !== 'folder') {
        selectableRequests.push({
          id: childItem.id,
          index: selectableRequestIndex++,
          tree: node,
        });
      }
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

  return { tree, treeParentMap, selectableRequests, selectedRequest };
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
