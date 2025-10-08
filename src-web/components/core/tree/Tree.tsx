import classNames from 'classnames';
import type { Atom } from 'jotai';
import type { ReactNode } from 'react';
import { useCallback, useRef, useState } from 'react';
import { useDrop } from 'react-dnd';
import { useKey, useKeyPressEvent } from 'react-use';
import { sidebarCollapsedAtom } from '../../../hooks/useSidebarItemCollapsed';
import { jotaiStore } from '../../../lib/jotai';
import type { DragItem } from '../../sidebar/dnd';
import type { TreeNode } from './atoms';
import { selectedFamily } from './atoms';
import { ItemTypes } from './dnd';
import type { TreeItemProps } from './TreeItem';
import { TreeItemList } from './TreeItemList';

export interface TreeProps<T extends { id: string }> {
  root: TreeNode<T>;
  treeId: string;
  getItemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  className?: string;
  activeIdAtom: Atom<string | null>;
  onActivate?: (items: T[]) => void;
}

export function Tree<T extends { id: string }>({
  root,
  treeId,
  getItemKey,
  renderItem,
  className,
  activeIdAtom,
  onActivate,
}: TreeProps<T>) {
  const treeRef = useRef<HTMLDivElement>(null);
  const [, setDraggingId] = useState<string | null>(null);
  const [hoveredParent, setHoveredParent] = useState<TreeNode<T> | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [hasFocus, setHasFocus] = useState<boolean>(false);
  const [anchorSelectedId, setAnchorSelectedId] = useState<string | null>(null);
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const { treeParentMap, selectableItems } = useTreeParentMap(root);

  const handleSelect = useCallback<TreeItemProps<T>['onClick']>(
    (item, { shiftKey }) => {
      setHasFocus(true);
      setLastSelectedId(item.id);
      const selectedIdsAtom = selectedFamily(treeId);
      if (shiftKey) {
        const selectedIds = jotaiStore.get(selectedIdsAtom);

        // Nothing was selected yet, so just select this item
        const anchorIndex = selectableItems.findIndex((i) => i.node.item.id === anchorSelectedId);
        const currIndex = selectableItems.findIndex((v) => v.node.item.id === item.id);
        if (selectedIds.length === 0 || anchorIndex === -1 || currIndex === -1) {
          console.log('SELECTED FIRST', item.id);
          jotaiStore.set(selectedIdsAtom, [item.id]);
          setAnchorSelectedId(item.id);
          return;
        }

        console.log('SELECTING FROM', anchorIndex, '->', currIndex, { id: item.id });

        if (currIndex > anchorIndex) {
          // Selecting down
          const itemsToSelect = selectableItems.slice(anchorIndex, currIndex+1);
          jotaiStore.set(
            selectedIdsAtom,
            itemsToSelect.map((v) => v.node.item.id),
          );
        } else if (currIndex < anchorIndex){
          // Selecting up
          const itemsToSelect = selectableItems.slice(currIndex, anchorIndex);
          jotaiStore.set(
            selectedIdsAtom,
            itemsToSelect.map((v) => v.node.item.id),
          );
        } else {
          jotaiStore.set(selectedIdsAtom, [item.id]);
        }
      } else {
        // Select single
        console.log('SELECTED SINGLE', item.id);
        jotaiStore.set(selectedIdsAtom, [item.id]);
        setAnchorSelectedId(item.id);
      }
    },
    [anchorSelectedId, selectableItems, treeId],
  );

  const handleClick = useCallback<TreeItemProps<T>['onClick']>(
    (item, e) => {
      handleSelect(item, e);
      const items = getSelectedItems(treeId, selectableItems);
      onActivate?.(items);
    },
    [handleSelect, onActivate, selectableItems, treeId],
  );

  useKey(
    'ArrowUp',
    (e) => {
      if (!hasFocus) return;
      e.preventDefault();
      const index = selectableItems.findIndex((i) => i.node.item.id === lastSelectedId);
      const item = selectableItems[index - 1];
      if (item != null) handleSelect(item.node.item, e);
    },
    undefined,
    [hasFocus, selectableItems, anchorSelectedId, handleSelect],
  );

  useKey(
    'ArrowDown',
    (e) => {
      if (!hasFocus) return;
      e.preventDefault();
      const index = selectableItems.findIndex((i) => i.node.item.id === lastSelectedId);
      const item = selectableItems[index + 1];
      if (item != null) handleSelect(item.node.item, e);
    },
    undefined,
    [hasFocus, selectableItems, anchorSelectedId, handleSelect],
  );

  useKeyPressEvent('Enter', async (e) => {
    if (!hasFocus) {
      return;
    }
    const selected = selectableItems.find(
      (i) => i.node.item.id === jotaiStore.get(selectedFamily(treeId))[0],
    );
    if (selected == null) {
      return;
    }
    handleSelect(selected.node.item, e);
  });

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

  const handleClearSelected = useCallback(() => {
    jotaiStore.set(selectedFamily(treeId), []);
  }, [treeId]);

  const handleEnd = useCallback<TreeItemProps<T>['onEnd']>(
    async (item) => {
      setHoveredParent(null);
      setDraggingId(null);
      handleClearSelected();

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
    [handleClearSelected, hoveredParent, hoveredIndex, treeParentMap],
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
    <div
      ref={treeRef}
      tabIndex={-1}
      className={classNames(className, 'outline-none h-full overflow-x-hidden overflow-y-auto')}
    >
      <TreeItemList
        depth={0}
        getItemKey={getItemKey}
        hoveredIndex={hoveredIndex}
        hoveredParent={hoveredParent}
        node={root}
        onDragStart={handleDragStart}
        onEnd={handleEnd}
        onMove={handleMove}
        onClick={handleClick}
        renderItem={renderItem}
        activeIdAtom={activeIdAtom}
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

function getSelectedItems<T extends { id: string }>(
  treeId: string,
  selectableItems: SelectableTreeNode<T>[],
) {
  const selectedItemIds = jotaiStore.get(selectedFamily(treeId));
  return selectableItems
    .filter((i) => selectedItemIds.includes(i.node.item.id))
    .map((i) => i.node.item);
}
