import { jotaiStore } from '../../../lib/jotai';
import { selectedFamily } from './atoms';

export interface TreeNode<T extends { id: string }> {
  children?: TreeNode<T>[];
  item: T;
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
  const selectedItemIds = jotaiStore.get(selectedFamily(treeId));
  return selectableItems
    .filter((i) => selectedItemIds.includes(i.node.item.id))
    .map((i) => i.node.item);
}
