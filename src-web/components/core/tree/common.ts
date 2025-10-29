import { jotaiStore } from '../../../lib/jotai';
import { selectedIdsFamily } from './atoms';

export interface TreeNode<T extends { id: string }> {
  children?: TreeNode<T>[];
  item: T;
  hidden?: boolean;
  parent: TreeNode<T> | null;
  depth: number;
}

export interface SelectableTreeNode<T extends { id: string }> {
  node: TreeNode<T>;
  depth: number;
  index: number;
}

export function getSelectedItems<T extends { id: string }>(
  treeId: string,
  selectableItems: SelectableTreeNode<T>[],
) {
  const selectedItemIds = jotaiStore.get(selectedIdsFamily(treeId));
  return selectableItems
    .filter((i) => selectedItemIds.includes(i.node.item.id))
    .map((i) => i.node.item);
}

export function equalSubtree<T extends { id: string }>(
  a: TreeNode<T>,
  b: TreeNode<T>,
  getItemKey: (t: T) => string,
): boolean {
  if (getNodeKey(a, getItemKey) !== getNodeKey(b, getItemKey)) return false;
  const ak = a.children ?? [];
  const bk = b.children ?? [];
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    if (!equalSubtree(ak[i]!, bk[i]!, getItemKey)) return false;
  }

  return true;
}

export function getNodeKey<T extends { id: string }>(a: TreeNode<T>, getItemKey: (i: T) => string) {
  return getItemKey(a.item) + a.hidden;
}

export function hasAncestor<T extends { id: string }>(node: TreeNode<T>, ancestorId: string) {
  if (node.parent == null) return false;
  if (node.parent.item.id === ancestorId) return true;

  // Check parents recursively
  return hasAncestor(node.parent, ancestorId);
}
