import type { DragMoveEvent } from '@dnd-kit/core';
import { jotaiStore } from '../../../lib/jotai';
import { selectedIdsFamily } from './atoms';

export interface TreeNode<T extends { id: string }> {
  children?: TreeNode<T>[];
  item: T;
  parent: TreeNode<T> | null;
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
  getKey: (t: T) => string,
): boolean {
  if (getKey(a.item) !== getKey(b.item)) return false;
  const ak = a.children ?? [];
  const bk = b.children ?? [];
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    if (!equalSubtree(ak[i]!, bk[i]!, getKey)) return false;
  }

  return true;
}

export function hasAncestor<T extends { id: string }>(node: TreeNode<T>, ancestorId: string) {
  // Check parents recursively
  if (node.parent == null) return false;
  if (node.parent.item.id === ancestorId) return true;
  return hasAncestor(node.parent, ancestorId);
}

export function computeSideForDragMove<T extends { id: string }>(
  node: TreeNode<T>,
  e: DragMoveEvent,
): 'above' | 'below' | null {
  if (e.over == null || e.over.id !== node.item.id) {
    return null;
  }
  if (e.active.rect.current.initial == null) return null;

  const overRect = e.over.rect;
  const activeTop =
    e.active.rect.current.translated?.top ?? e.active.rect.current.initial.top + e.delta.y;
  const pointerY = activeTop + e.active.rect.current.initial.height / 2;

  const hoverTop = overRect.top;
  const hoverBottom = overRect.bottom;
  const hoverMiddleY = (hoverBottom - hoverTop) / 2;
  const hoverClientY = pointerY - hoverTop;

  return hoverClientY < hoverMiddleY ? 'above' : 'below';
}
