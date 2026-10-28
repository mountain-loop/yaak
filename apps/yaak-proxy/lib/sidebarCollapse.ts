import type { TreeNode } from "@yaakapp-internal/ui";

/** Flags by node id, as the tree reads them: true is collapsed, and a missing id is open */
export type CollapsedMap = Record<string, boolean>;

/** Domains and paths start collapsed; the rest, the Domains folder, starts open as before */
export function startsCollapsed(id: string): boolean {
  return id.startsWith("domain:") || id.startsWith("path:");
}

/** Ids of the nodes with children, the only ones that collapse */
export function folderIds(root: TreeNode<{ id: string }>): string[] {
  const ids: string[] = [];
  const walk = (node: TreeNode<{ id: string }>) => {
    if ((node.children?.length ?? 0) === 0) return;
    ids.push(node.item.id);
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return ids;
}

/**
 * The tree's collapsed flags: every domain and path collapsed unless the user expanded it, and
 * other nodes as the user left them.
 */
export function collapsedMap(
  folders: string[],
  expanded: Record<string, boolean>,
  others: CollapsedMap,
): CollapsedMap {
  const map = { ...others };
  for (const id of folders) {
    if (startsCollapsed(id)) map[id] = !expanded[id];
  }
  return map;
}

/**
 * Splits the flags the tree sets into the domains and paths now expanded, which are kept, and
 * the other nodes' flags. Only the nodes whose flag changed from `prev` count.
 */
export function applyCollapsed(
  prev: CollapsedMap,
  next: CollapsedMap,
  expanded: Record<string, boolean>,
  others: CollapsedMap,
): { expanded: Record<string, boolean>; others: CollapsedMap } {
  const nextExpanded = { ...expanded };
  const nextOthers = { ...others };
  for (const id of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    const collapsed = next[id] === true;
    if (collapsed === (prev[id] === true)) continue;
    if (!startsCollapsed(id)) nextOthers[id] = collapsed;
    else if (collapsed) delete nextExpanded[id];
    else nextExpanded[id] = true;
  }
  return { expanded: nextExpanded, others: nextOthers };
}
