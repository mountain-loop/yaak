import { DragOverlay } from '@dnd-kit/core';
import { useAtomValue } from 'jotai';
import { draggingIdsFamily } from './atoms';
import type { SelectableTreeNode, TreeNode } from './common';
import type { TreeProps } from './Tree';
import { TreeItemList } from './TreeItemList';

export function TreeDragOverlay<T extends { id: string }>({
  treeId,
  root,
  selectableItems,
  getItemKey,
  renderItem,
}: {
  treeId: string;
  root: TreeNode<T>;
  selectableItems: SelectableTreeNode<T>[];
} & Pick<TreeProps<T>, 'getItemKey' | 'renderItem'>) {
  const draggingItems = useAtomValue(draggingIdsFamily(treeId));
  return (
    <DragOverlay dropAnimation={null}>
      <TreeItemList
        treeId={treeId + '.dragging'}
        node={{
          item: { ...root.item, id: `${root.item.id}_dragging` },
          parent: null,
          children: draggingItems.map((id) => {
            const child = selectableItems.find((i2) => {
              return i2.node.item.id === id;
            })!.node;
            return { ...child, children: undefined };
            // Remove children so we don't render them in the drag preview
          }),
        }}
        getItemKey={getItemKey}
        renderItem={renderItem}
        depth={0}
      />
    </DragOverlay>
  );
}
