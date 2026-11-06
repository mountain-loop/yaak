import type { Flow } from "@yaakapp-internal/proxy-lib";
import type { TreeNode } from "@yaakapp-internal/ui";
import { selectedIdsFamily, Tree } from "@yaakapp-internal/ui";
import { atom, useAtomValue } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useCallback } from "react";
import { SIDEBAR_TREE_ID } from "../lib/atoms";
import { appKeyOf, appNodeId, sidebarPath } from "../lib/search";
import { applyCollapsed, type CollapsedMap, collapsedMap, folderIds } from "../lib/sidebarCollapse";
import { flowsAtom, flowTotalAtom } from "../lib/store";
import { AppIcon } from "./AppIcon";

/** A node in the sidebar tree: a domain, a path segment, or an app. */
export type SidebarItem = {
  id: string;
  label: string;
  /** Flows held under this node; for the Domains folder, every flow in the database */
  count: number;
  /** An app's path, for its icon */
  appPath?: string;
};

const sidebarTreeAtom = atom<TreeNode<SidebarItem>>((get) => {
  const exchanges = get(flowsAtom);
  return buildTree(exchanges, get(flowTotalAtom));
});

/** The domains and paths the user expanded, by node id, kept across launches */
const expandedAtom = atomWithStorage<Record<string, boolean>>("sidebar_expanded", {}, undefined, {
  getOnInit: true,
});

/** The other nodes' collapsed flags, for this launch, as before */
const otherCollapsedAtom = atom<CollapsedMap>({});

/** Domains and paths collapsed until the user expands them, for the tree */
const collapsedAtom = atom(
  (get) =>
    collapsedMap(folderIds(get(sidebarTreeAtom)), get(expandedAtom), get(otherCollapsedAtom)),
  (get, set, action: CollapsedMap | ((prev: CollapsedMap) => CollapsedMap)) => {
    const prev = get(collapsedAtom);
    const next = typeof action === "function" ? action(prev) : action;
    const split = applyCollapsed(prev, next, get(expandedAtom), get(otherCollapsedAtom));
    set(expandedAtom, split.expanded);
    set(otherCollapsedAtom, split.others);
  },
);

/** The selected sidebar node's name, for the header */
export const selectedSidebarLabelAtom = atom((get) => {
  const selectedId = get(selectedIdsFamily(SIDEBAR_TREE_ID))[0];
  if (selectedId?.startsWith("domain:")) return selectedId.slice("domain:".length);
  if (selectedId?.startsWith("path:")) return selectedId.slice("path:".length);
  if (selectedId?.startsWith("app:")) {
    const apps = get(sidebarTreeAtom).children?.find((c) => c.item.id === "apps");
    return apps?.children?.find((c) => c.item.id === selectedId)?.item.label ?? "All traffic";
  }
  return "All traffic";
});

const nodeIdsByFlow = new WeakMap<Flow, string[]>();

/**
 * The ids of the nodes a flow sits under, its domain first and then each path segment's, parsed
 * once per flow rather than on every change to the list.
 */
function nodeIdsOf(ex: Flow): string[] {
  let ids = nodeIdsByFlow.get(ex);
  if (ids != null) return ids;
  // By the rules the database filters by, so a node shows the flows it counts.
  const path = sidebarPath(ex.url);
  const schemeless = !ex.url.includes("://");
  const [hostname = "", ...segments] = schemeless ? [path] : path.split("/");
  ids = [`domain:${hostname}`];
  let node = `path:${hostname}`;
  for (const seg of segments) {
    node += `/${seg}`;
    ids.push(node);
  }
  nodeIdsByFlow.set(ex, ids);
  return ids;
}

const collator = new Intl.Collator();

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
function buildTree(exchanges: Flow[], total: number): TreeNode<SidebarItem> {
  const root: SidebarItem = { id: "root", label: "All Traffic", count: 0 };
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
    count: number;
    children: Map<string, TrieNode>;
  };

  const domainMap = new Map<string, TrieNode>();

  for (const ex of exchanges) {
    const ids = nodeIdsOf(ex);
    let current: TrieNode | undefined;
    for (const id of ids) {
      const siblings = current == null ? domainMap : current.children;
      let node = siblings.get(id);
      if (node == null) {
        // The domain, or the path's last segment
        const label = current == null ? id.slice("domain:".length) : id.slice(id.lastIndexOf("/"));
        node = { id, label, count: 0, children: new Map() };
        siblings.set(id, node);
      }
      node.count++;
      current = node;
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
        count: trie.count,
      },
      parent,
      depth,
      children: [],
      draggable: false,
    };
    const sortedChildren = [...trie.children.values()].sort((a, b) =>
      collator.compare(a.label, b.label),
    );
    for (const child of sortedChildren) {
      node.children?.push(toTreeNode(child, node, depth + 1));
    }
    return node;
  }

  // Add a "Domains" folder between root and domain nodes
  const domainsFolder: TreeNode<SidebarItem> = {
    item: { id: "domains", label: "Domains", count: total },
    parent: rootNode,
    depth: 1,
    children: [],
    draggable: false,
  };

  const sortedDomains = [...domainMap.values()].sort((a, b) => collator.compare(a.label, b.label));
  for (const domain of sortedDomains) {
    domainsFolder.children?.push(toTreeNode(domain, domainsFolder, 2));
  }

  // The apps flows came from, where the platform can tell; none on others, so no group.
  const apps = new Map<string, SidebarItem>();
  for (const ex of exchanges) {
    const key = appKeyOf(ex);
    if (key == null) continue;
    const id = appNodeId(key);
    const app = apps.get(id);
    if (app == null) {
      apps.set(id, { id, label: ex.clientName ?? key, count: 1, appPath: ex.clientPath ?? key });
    } else {
      app.count++;
    }
  }
  if (apps.size > 0) {
    const appsFolder: TreeNode<SidebarItem> = {
      item: { id: "apps", label: "Apps", count: 0 },
      parent: rootNode,
      depth: 1,
      children: [],
      draggable: false,
    };
    const sortedApps = [...apps.values()].sort((a, b) => collator.compare(a.label, b.label));
    for (const item of sortedApps) {
      appsFolder.children?.push({ item, parent: appsFolder, depth: 2, draggable: false });
    }
    rootNode.children?.push(appsFolder);
  }

  rootNode.children?.push(domainsFolder);

  return rootNode;
}

function ItemInner({ item }: { item: SidebarItem }) {
  const count = item.count;
  return (
    <div className="flex items-center gap-2 w-full min-w-0">
      {item.appPath != null && <AppIcon path={item.appPath} />}
      <span className="truncate">{item.label}</span>
      {count > 0 && <span className="ml-auto text-text-subtlest text-2xs shrink-0">{count}</span>}
    </div>
  );
}

export function Sidebar() {
  const tree = useAtomValue(sidebarTreeAtom);

  const getItemKey = useCallback((item: SidebarItem) => `${item.id}:${item.count}`, []);
  const treeId = SIDEBAR_TREE_ID;

  return (
    // The tree scrolls itself, in a row of bounded height, so its virtualizer mounts only the rows
    // in view rather than every domain and path.
    <aside className="x-theme-sidebar bg-surface h-full w-full min-w-0 grid grid-rows-[minmax(0,1fr)] border-r border-border-subtle">
      <Tree
        treeId={treeId}
        collapsedAtom={collapsedAtom}
        className="px-2 pt-2 pb-10"
        root={tree}
        getItemKey={getItemKey}
        ItemInner={ItemInner}
      />
    </aside>
  );
}
