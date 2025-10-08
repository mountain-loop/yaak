import type { Atom } from 'jotai';
import type { ReactNode } from 'react';
import { useCallback, useRef, useState } from 'react';
import { useDrop } from 'react-dnd';
import { sidebarCollapsedAtom } from '../../../hooks/useSidebarItemCollapsed';
import { jotaiStore } from '../../../lib/jotai';
import type { DragItem } from '../../sidebar/dnd';
import type { TreeNode } from './atoms';
import { ItemTypes } from './dnd';
import type { TreeItemProps } from './TreeItem';
import { TreeItemList } from './TreeItemList';

export interface TreeProps<T extends { id: string }> {
  root: TreeNode<T>;
  treeId: string;
  getItemKey: (item: T) => string;
  renderRow: (item: T) => ReactNode;
  className?: string;
  selectedIdAtom: Atom<string | null>;
  onSelect?: (item: T) => void;
}

export function Tree<T extends { id: string }>({
  root,
  treeId,
  getItemKey,
  renderRow,
  className,
  selectedIdAtom,
  onSelect,
}: TreeProps<T>) {
  const treeRef = useRef<HTMLDivElement>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoveredParent, setHoveredParent] = useState<TreeNode<T> | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const { treeParentMap, selectableItems } = useTreeParentMap(root);

  const handleMove = useCallback<TreeItemProps<T>['onMove']>(
    (item, side) => {
      let hoveredParent = treeParentMap[item.id] ?? null;
      const dragIndex = hoveredParent?.children?.findIndex((n) => n.item.id === item.id) ?? -99;
      const hovered = hoveredParent?.children?.[dragIndex] ?? null;
      let hoveredIndex = dragIndex + (side === 'above' ? 0 : 1);

      const collapsedMap = jotaiStore.get(jotaiStore.get(sidebarCollapsedAtom));
      const isHoveredItemCollapsed = hovered != null ? collapsedMap[hovered.item.id] : false;

      if (hovered?.children != null && side === 'below' && !isHoveredItemCollapsed) {
        // Move into the folder if it's open and we're moving below it
        hoveredParent = hoveredParent?.children?.find((n) => n.item.id === item.id) ?? null;
        hoveredIndex = 0;
      }

      setHoveredParent(hoveredParent);
      setHoveredIndex(hoveredIndex);
    },
    [treeParentMap],
  );

  const handleDragStart = useCallback<TreeItemProps<T>['onDragStart']>((item: T) => {
    console.log('DRAG START: ', item);
    setDraggingId(item.id);
  }, []);

  const handleEnd = useCallback<TreeItemProps<T>['onEnd']>(
    async (item) => {
      setHoveredParent(null);
      setDraggingId(null);
      // handleClearSelected();

      if (hoveredParent == null || hoveredIndex == null) {
        return;
      }

      // Block dragging folder into itself
      if (hoveredParent.item.id === item.id) {
        return;
      }

      const parentTree = treeParentMap[item.id] ?? null;
      const index = parentTree?.children?.findIndex((n) => n.item.id === item.id) ?? -1;
      const child = parentTree?.children?.[index ?? -1];
      if (child == null || parentTree == null) return;

      const movedToDifferentTree = hoveredParent.item.id !== parentTree.item.id;
      const movedUpInSameTree = !movedToDifferentTree && hoveredIndex < index;

      const newChildren = hoveredParent.children?.filter((n) => n.item.id !== item.id);
      if (newChildren == null) {
        return;
      }

      if (movedToDifferentTree || movedUpInSameTree) {
        // Moving up or into a new tree is simply inserting before the hovered item
        newChildren.splice(hoveredIndex, 0, child);
      } else {
        // Moving down has to account for the fact that the original item will be removed
        newChildren.splice(hoveredIndex - 1, 0, child);
      }

      const insertedIndex = newChildren.findIndex((n) => n.item.id === child.item.id);
      const prev = newChildren[insertedIndex - 1];
      const next = newChildren[insertedIndex + 1];

      console.log('DROP END', { prev, next });
      // const beforePriority = prev?.sortPriority ?? 0;
      // const afterPriority = next?.sortPriority ?? 0;
      //
      // const folderId = hoveredTree.model === 'folder' ? hoveredTree.id : null;
      // const shouldUpdateAll = afterPriority - beforePriority < 1;
      //
      // if (shouldUpdateAll) {
      //   await Promise.all(
      //     newChildren.map((child, i) => {
      //       const sortPriority = i * 1000;
      //       return patchModelById(child.model, child.id, { sortPriority, folderId });
      //     }),
      //   );
      // } else {
      //   const sortPriority = afterPriority - (afterPriority - beforePriority) / 2;
      //   await patchModelById(child.model, child.id, { sortPriority, folderId });
      // }
    },
    [hoveredParent, hoveredIndex, treeParentMap],
  );

  const handleMoveToSidebarEnd = useCallback(() => {
    console.log('ON MOVE SIDEBAR END');
    setHoveredParent(root);
    // Put at the end of the top tree
    setHoveredIndex(root.children?.length ?? 0);
  }, [root]);

  const [, connectDrop] = useDrop<DragItem, void>(
    {
      accept: ItemTypes.TREE_ITEM,
      hover: (_, monitor) => {
        if (treeRef.current == null) return;
        if (!monitor.isOver({ shallow: true })) return;
        handleMoveToSidebarEnd();
      },
    },
    [handleMoveToSidebarEnd],
  );

  connectDrop(treeRef);

  return (
    <div ref={treeRef} className={className}>
      <TreeItemList
        depth={0}
        getItemKey={getItemKey}
        hoveredIndex={hoveredIndex}
        hoveredNode={hoveredParent}
        node={root}
        onDragStart={handleDragStart}
        onEnd={handleEnd}
        onMove={handleMove}
        onSelect={onSelect}
        renderRow={renderRow}
        selectedIdAtom={selectedIdAtom}
        treeId={treeId}
      />
    </div>
  );
}

interface SelectableTreeNode<T extends { id: string }> {
  node: TreeNode<T>;
  depth: number;
  index: number;
}

function useTreeParentMap<T extends { id: string }>(root: TreeNode<T>) {
  const collapsedMap = jotaiStore.get(jotaiStore.get(sidebarCollapsedAtom));
  const treeParentMap: Record<string, TreeNode<T>> = {};

  const selectableItems: SelectableTreeNode<T>[] = [];

  // Put requests and folders into a tree structure
  const next = (node: TreeNode<T>, depth: number = 0) => {
    const isCollapsed = collapsedMap[node.item.id] === true;
    if (node.children == null) {
      return;
    }

    // Recurse to children
    let selectableIndex = 0;
    for (const child of node.children) {
      treeParentMap[child.item.id] = node;
      if (!isCollapsed) {
        selectableItems.push({
          node: child,
          index: selectableIndex++,
          depth,
        });
      }

      next(child, depth + 1);
    }
  };

  next(root);

  return {
    treeParentMap,
    selectableItems,
  };
}
