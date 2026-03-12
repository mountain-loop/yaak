import type { HttpExchange } from '@yaakapp-internal/proxy-lib';
import type { TreeNode } from '@yaakapp-internal/ui';
import { selectedIdsFamily, Tree } from '@yaakapp-internal/ui';
import { atom, useAtomValue } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { useCallback } from 'react';
import { httpExchangesAtom } from '../lib/store';

/** A node in the sidebar tree — either a domain or a path segment. */
export type SidebarItem = {
  id: string;
  label: string;
  exchangeIds: string[];
};

const collapsedAtom = atomFamily((_treeId: string) => atom<Record<string, boolean>>({}));

export const SIDEBAR_TREE_ID = 'proxy-sidebar';

const sidebarTreeAtom = atom<TreeNode<SidebarItem>>((get) => {
  const exchanges = get(httpExchangesAtom);
  return buildTree(exchanges);
});

/** Exchanges filtered by the currently selected sidebar node(s). */
export const filteredExchangesAtom = atom((get) => {
  const exchanges = get(httpExchangesAtom);
  const tree = get(sidebarTreeAtom);
  const selectedIds = get(selectedIdsFamily(SIDEBAR_TREE_ID));

  // Nothing selected or root selected → show all
  if (selectedIds.length === 0 || selectedIds.includes('root')) {
    return exchanges;
  }

  // Collect exchange IDs from all selected nodes
  const allowedIds = new Set<string>();
  const nodeMap = new Map<string, SidebarItem>();
  collectNodes(tree, nodeMap);

  for (const selectedId of selectedIds) {
    const node = nodeMap.get(selectedId);
    if (node) {
      for (const id of node.exchangeIds) {
        allowedIds.add(id);
      }
    }
  }

  return exchanges.filter((ex) => allowedIds.has(ex.id));
});

function collectNodes(node: TreeNode<SidebarItem>, map: Map<string, SidebarItem>) {
  map.set(node.item.id, node.item);
  for (const child of node.children ?? []) {
    collectNodes(child, map);
  }
}

/**
 * Build a domain → path-segment trie from a flat list of exchanges.
 *
 * Example: Given URLs
 *   GET https://api.example.com/v1/users
 *   GET https://api.example.com/v1/users/123
 *   POST https://api.example.com/v1/orders
 *
 * Produces:
 *   api.example.com
 *     /v1
 *       /users
 *         /123
 *       /orders
 */
function buildTree(exchanges: HttpExchange[]): TreeNode<SidebarItem> {
  const root: SidebarItem = { id: 'root', label: 'All Traffic', exchangeIds: [] };
  const rootNode: TreeNode<SidebarItem> = {
    item: root,
    parent: null,
    depth: 0,
    children: [],
    draggable: false,
  };

  // Intermediate trie structure for building
  type TrieNode = {
    id: string;
    label: string;
    exchangeIds: string[];
    children: Map<string, TrieNode>;
  };

  const domainMap = new Map<string, TrieNode>();

  for (const ex of exchanges) {
    let hostname: string;
    let segments: string[];
    try {
      const url = new URL(ex.url);
      hostname = url.host;
      segments = url.pathname.split('/').filter(Boolean);
    } catch {
      hostname = ex.url;
      segments = [];
    }

    // Get or create domain node
    let domainNode = domainMap.get(hostname);
    if (!domainNode) {
      domainNode = {
        id: `domain:${hostname}`,
        label: hostname,
        exchangeIds: [],
        children: new Map(),
      };
      domainMap.set(hostname, domainNode);
    }
    domainNode.exchangeIds.push(ex.id);

    // Walk path segments
    let current = domainNode;
    const pathSoFar: string[] = [];
    for (const seg of segments) {
      pathSoFar.push(seg);
      let child = current.children.get(seg);
      if (!child) {
        child = {
          id: `path:${hostname}/${pathSoFar.join('/')}`,
          label: `/${seg}`,
          exchangeIds: [],
          children: new Map(),
        };
        current.children.set(seg, child);
      }
      child.exchangeIds.push(ex.id);
      current = child;
    }
  }

  // Convert trie to TreeNode structure
  function toTreeNode(
    trie: TrieNode,
    parent: TreeNode<SidebarItem>,
    depth: number,
  ): TreeNode<SidebarItem> {
    const node: TreeNode<SidebarItem> = {
      item: {
        id: trie.id,
        label: trie.label,
        exchangeIds: trie.exchangeIds,
      },
      parent,
      depth,
      children: [],
      draggable: false,
    };
    const sortedChildren = [...trie.children.values()].sort((a, b) =>
      a.label.localeCompare(b.label),
    );
    for (const child of sortedChildren) {
      node.children?.push(toTreeNode(child, node, depth + 1));
    }
    return node;
  }

  // Add a "Domains" folder between root and domain nodes
  const allExchangeIds = exchanges.map((ex) => ex.id);
  const domainsFolder: TreeNode<SidebarItem> = {
    item: { id: 'domains', label: 'Domains', exchangeIds: allExchangeIds },
    parent: rootNode,
    depth: 1,
    children: [],
    draggable: false,
  };

  const sortedDomains = [...domainMap.values()].sort((a, b) => a.label.localeCompare(b.label));
  for (const domain of sortedDomains) {
    domainsFolder.children?.push(toTreeNode(domain, domainsFolder, 2));
  }

  rootNode.children?.push(domainsFolder);

  return rootNode;
}

function ItemInner({ item }: { item: SidebarItem }) {
  const count = item.exchangeIds.length;
  return (
    <div className="flex items-center gap-2 w-full min-w-0">
      <span className="truncate">{item.label}</span>
      {count > 0 && <span className="text-text-subtlest text-2xs shrink-0">{count}</span>}
    </div>
  );
}

export function Sidebar() {
  const tree = useAtomValue(sidebarTreeAtom);
  const treeId = SIDEBAR_TREE_ID;

  const getItemKey = useCallback((item: SidebarItem) => `${item.id}:${item.exchangeIds.length}`, []);

  return (
    <aside className="x-theme-sidebar bg-surface h-full w-full min-w-0 overflow-y-auto border-r border-border-subtle">
      <div className="pt-2 text-xs">
        <Tree
          treeId={treeId}
          collapsedAtom={collapsedAtom(treeId)}
          className="px-2 pb-10"
          root={tree}
          getItemKey={getItemKey}
          ItemInner={ItemInner}
        />
      </div>
    </aside>
  );
}
