import { DragOverlay } from '@dnd-kit/core';
import { useAtomValue } from 'jotai';
import { draggingIdsFamily } from './atoms';
import type { SelectableTreeNode } from './common';
import type { TreeProps } from './Tree';
import { TreeItemList } from './TreeItemList';

export function TreeDragOverlay<T extends { id: string }>({
  treeId,
  selectableItems,
  getItemKey,
  ItemInner,
  ItemLeftSlot,
}: {
  treeId: string;
  selectableItems: SelectableTreeNode<T>[];
} & Pick<TreeProps<T>, 'getItemKey' | 'ItemInner' | 'ItemLeftSlot'>) {
  const draggingItems = useAtomValue(draggingIdsFamily(treeId));
  return (
    <DragOverlay dropAnimation={null}>
      <TreeItemList
        treeId={treeId + '.dragging'}
        nodes={selectableItems.filter((i) => draggingItems.includes(i.node.item.id))}
        getItemKey={getItemKey}
        ItemInner={ItemInner}
        ItemLeftSlot={ItemLeftSlot}
        forceDepth={0}
      />
    </DragOverlay>
  );
}
