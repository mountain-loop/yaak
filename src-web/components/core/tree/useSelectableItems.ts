import { useMemo } from 'react';
import type { SelectableTreeNode, TreeNode } from './common';

export function useSelectableItems<T extends { id: string }>(root: TreeNode<T>) {
  return useMemo(() => {
    const selectableItems: SelectableTreeNode<T>[] = [];

    // Put requests and folders into a tree structure
    const next = (node: TreeNode<T>, depth: number = 0) => {
      if (node.children == null) {
        return;
      }

      // Recurse to children
      let selectableIndex = 0;
      for (const child of node.children) {
        selectableItems.push({
          node: child,
          index: selectableIndex++,
          depth,
        });

        next(child, depth + 1);
      }
    };

    next(root);
    return selectableItems;
  }, [root]);
}
