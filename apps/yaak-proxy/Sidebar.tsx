import type { HttpExchange } from "@yaakapp-internal/proxy-lib";
import { Tree } from "@yaakapp-internal/ui";
import type { TreeNode } from "@yaakapp-internal/ui";
import { atom, useAtomValue } from "jotai";
import { atomFamily } from "jotai/utils";
import { useCallback, useMemo } from "react";
import { httpExchangesAtom } from "./store";

/** A node in the sidebar tree — either a domain or a path segment. */
export type SidebarItem = {
  id: string;
  label: string;
  exchangeIds: string[];
};

const collapsedAtom = atomFamily((treeId: string) =>
  atom<Record<string, boolean>>({}),
);

const sidebarTreeAtom = atom<TreeNode<SidebarItem>>((get) => {
  const exchanges = get(httpExchangesAtom);
  return buildTree(exchanges);
});

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
  const root: SidebarItem = { id: "root", label: "All Traffic", exchangeIds: [] };
  const rootNode: TreeNode<SidebarItem> = {
    item: root,
    parent: null,
    depth: 0,
    children: [],
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
      segments = url.pathname.split("/").filter(Boolean);
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
          id: `path:${hostname}/${pathSoFar.join("/")}`,
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
    };
    for (const child of trie.children.values()) {
      node.children!.push(toTreeNode(child, node, depth + 1));
    }
    return node;
  }

  // Sort domains alphabetically, add to root
  const sortedDomains = [...domainMap.values()].sort((a, b) =>
    a.label.localeCompare(b.label),
  );
  for (const domain of sortedDomains) {
    rootNode.children!.push(toTreeNode(domain, rootNode, 1));
  }

  return rootNode;
}

function ItemInner({ item }: { item: SidebarItem }) {
  const count = item.exchangeIds.length;
  return (
    <div className="flex items-center gap-2 w-full min-w-0">
      <span className="truncate">{item.label}</span>
      {count > 0 && (
        <span className="text-text-subtlest text-2xs shrink-0">{count}</span>
      )}
    </div>
  );
}

export function Sidebar() {
  const tree = useAtomValue(sidebarTreeAtom);
  const treeId = "proxy-sidebar";

  const getItemKey = useCallback((item: SidebarItem) => item.id, []);

  return (
    <aside className="x-theme-sidebar h-full w-[250px] min-w-0 overflow-y-auto border-r border-border-subtle">
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
