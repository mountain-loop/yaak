import classNames from 'classnames';
import type { Atom } from 'jotai';
import { useAtomValue } from 'jotai';
import type { ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDrop } from 'react-dnd';
import { useKey, useKeyPressEvent } from 'react-use';
import { sidebarCollapsedAtom } from '../../../hooks/useSidebarItemCollapsed';
import { jotaiStore } from '../../../lib/jotai';
import type { DragItem } from '../../sidebar/dnd';
import type { ContextMenuProps } from '../Dropdown';
import { selectedIdsFamily } from './atoms';
import type { SelectableTreeNode, TreeNode } from './common';
import { equalSubtree, getSelectedItems } from './common';
import { CustomDragLayer } from './CustomDragLayer';
import { ItemTypes } from './dnd';
import type { TreeItemProps } from './TreeItem';
import type { TreeItemListProps } from './TreeItemList';
import { TreeItemList } from './TreeItemList';

export interface TreeProps<T extends { id: string }> {
  root: TreeNode<T>;
  treeId: string;
  getItemKey: (item: T) => string;
  getContextMenu?: (items: T[]) => ContextMenuProps['items'];
  renderItem: (item: T) => ReactNode;
  renderLeftSlot?: (item: T) => ReactNode;
  className?: string;
  activeIdAtom?: Atom<string | null>;
  onActivate?: (items: T[]) => void;
  getEditOptions?: (item: T) => {
    defaultValue: string;
    placeholder?: string;
    onChange: (item: T, text: string) => void;
  };
}

function Tree_<T extends { id: string }>({
  root,
  treeId,
  getItemKey,
  getContextMenu,
  renderItem,
  renderLeftSlot,
  className,
  activeIdAtom,
  onActivate,
  getEditOptions,
}: TreeProps<T>) {
  const treeRef = useRef<HTMLDivElement>(null);
  const [draggingItems, setDraggingItems] = useState<T[]>([]);
  const [hoveredParent, setHoveredParent] = useState<TreeNode<T> | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [hasFocus, setHasFocus] = useState<boolean>(false);
  const anchorSelectedId = useRef<string | null>(null);
  const lastSelectedId = useRef<string | null>(null);
  const { treeParentMap, selectableItems } = useTreeParentMap(root, getItemKey);

  const handleGetContextMenu = useMemo(() => {
    if (getContextMenu == null) return;
    return (item: T) => {
      const items = getSelectedItems(treeId, selectableItems);
      const isSelected = items.find((i) => i.id === item.id);
      if (isSelected) {
        // If right-clicked an item that was in the multiple-selection, use the entire selection
        return getContextMenu(items);
      } else {
        // If right-clicked an item that was NOT in the multiple-selection, just use that one
        // Also update the selection with it
        jotaiStore.set(selectedIdsFamily(treeId), [item.id]);
        lastSelectedId.current = item.id;
        return getContextMenu([item]);
      }
    };
  }, [getContextMenu, selectableItems, treeId]);

  const handleSelect = useCallback<NonNullable<TreeItemProps<T>['onClick']>>(
    (item, { shiftKey, metaKey, ctrlKey }) => {
      setHasFocus(true);
      lastSelectedId.current = item.id;
      const selectedIdsAtom = selectedIdsFamily(treeId);
      const selectedIds = jotaiStore.get(selectedIdsAtom);

      if (shiftKey) {
        // Nothing was selected yet, so just select this item
        const anchorIndex = selectableItems.findIndex(
          (i) => i.node.item.id === anchorSelectedId.current,
        );
        const currIndex = selectableItems.findIndex((v) => v.node.item.id === item.id);
        if (selectedIds.length === 0 || anchorIndex === -1 || currIndex === -1) {
          jotaiStore.set(selectedIdsAtom, [item.id]);
          anchorSelectedId.current = item.id;
          return;
        }

        if (currIndex > anchorIndex) {
          // Selecting down
          const itemsToSelect = selectableItems.slice(anchorIndex, currIndex + 1);
          jotaiStore.set(
            selectedIdsAtom,
            itemsToSelect.map((v) => v.node.item.id),
          );
        } else if (currIndex < anchorIndex) {
          // Selecting up
          const itemsToSelect = selectableItems.slice(currIndex, anchorIndex + 1);
          jotaiStore.set(
            selectedIdsAtom,
            itemsToSelect.map((v) => v.node.item.id),
          );
        } else {
          jotaiStore.set(selectedIdsAtom, [item.id]);
        }
      } else if (metaKey || ctrlKey) {
        const withoutCurr = selectedIds.filter((id) => id !== item.id);
        if (withoutCurr.length === selectedIds.length) {
          // It wasn't in there, so add it
          jotaiStore.set(selectedIdsAtom, [...selectedIds, item.id]);
        } else {
          // It was in there, so remove it
          jotaiStore.set(selectedIdsAtom, withoutCurr);
        }
      } else {
        // Select single
        jotaiStore.set(selectedIdsAtom, [item.id]);
        anchorSelectedId.current = item.id;
      }
    },
    [selectableItems, treeId],
  );

  const handleClick = useCallback<NonNullable<TreeItemProps<T>['onClick']>>(
    (item, e) => {
      handleSelect(item, e);

      // Only call onActivate if the user didn't use a modifier key to change the selection
      if (!(e.shiftKey || e.ctrlKey || e.metaKey)) {
        const items = getSelectedItems(treeId, selectableItems);
        onActivate?.(items);
      }
    },
    [handleSelect, onActivate, selectableItems, treeId],
  );

  useKey(
    'ArrowUp',
    (e) => {
      if (!hasFocus) return;
      e.preventDefault();
      const index = selectableItems.findIndex((i) => i.node.item.id === lastSelectedId.current);
      const item = selectableItems[index - 1];
      if (item != null) handleSelect(item.node.item, e);
    },
    undefined,
    [hasFocus, selectableItems, handleSelect],
  );

  useKey(
    'ArrowDown',
    (e) => {
      if (!hasFocus) return;
      e.preventDefault();
      const index = selectableItems.findIndex((i) => i.node.item.id === lastSelectedId.current);
      const item = selectableItems[index + 1];
      if (item != null) handleSelect(item.node.item, e);
    },
    undefined,
    [hasFocus, selectableItems, handleSelect],
  );

  useKeyPressEvent('Enter', async () => {
    if (!hasFocus) {
      return;
    }
    const items = getSelectedItems(treeId, selectableItems);
    onActivate?.(items);
  });

  const handleMove = useCallback<NonNullable<TreeItemProps<T>['onMove']>>(
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

  const handleDragStart = useCallback<NonNullable<TreeItemProps<T>['onDragStart']>>(
    (item: T) => {
      const selectedItems = getSelectedItems(treeId, selectableItems);
      if (selectedItems.find((i) => i.id === item.id)) {
        setDraggingItems(selectedItems);
      } else {
        setDraggingItems([item]);
      }
    },
    [selectableItems, treeId],
  );

  const handleClearSelected = useCallback(() => {
    jotaiStore.set(selectedIdsFamily(treeId), []);
  }, [treeId]);

  const handleEnd = useCallback<NonNullable<TreeItemProps<T>['onEnd']>>(
    async (item) => {
      setHoveredParent(null);
      setDraggingItems([]);
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

  const treeItemProps: Omit<
    TreeItemListProps<T>,
    'node' | 'treeId' | 'activeIdAtom' | 'hoveredParent' | 'hoveredIndex'
  > = {
    depth: 0,
    getItemKey: getItemKey,
    getContextMenu: handleGetContextMenu,
    onDragStart: handleDragStart,
    onEnd: handleEnd,
    onMove: handleMove,
    onClick: handleClick,
    getEditOptions,
    renderItem: renderItem,
    renderLeftSlot: renderLeftSlot,
  };

  return (
    <div
      ref={treeRef}
      tabIndex={-1}
      className={classNames(
        className,
        'outline-none h-full',
        'pr-[1px]', // Room to have an outline on each item
      )}
    >
      <CustomDragLayer>
        <TreeItemList
          treeId={treeId + '.dragging'}
          hoveredIndex={null}
          hoveredParent={null}
          node={{
            item: { ...root.item, id: `${root.item.id}_dragging` },
            children: draggingItems.map((i) => {
              const child = selectableItems.find((i2) => i2.node.item.id === i.id)!.node;
              // Remove children so we don't render them in the drag preview
              return { ...child, children: undefined };
            }),
          }}
          {...treeItemProps}
        />
      </CustomDragLayer>
      <TreeItemList
        node={root}
        treeId={treeId}
        activeIdAtom={activeIdAtom}
        hoveredIndex={hoveredIndex}
        hoveredParent={hoveredParent}
        {...treeItemProps}
      />
    </div>
  );
}

export const Tree = memo(
  Tree_,
  ({ root: prevNode, ...prevProps }, { root: nextNode, ...nextProps }) => {
    for (const key of Object.keys(prevProps)) {
      if (prevProps[key as keyof typeof prevProps] !== nextProps[key as keyof typeof nextProps]) {
        return false;
      }
    }
    return equalSubtree(prevNode, nextNode, nextProps.getItemKey);
  },
) as typeof Tree_;

function useTreeParentMap<T extends { id: string }>(
  root: TreeNode<T>,
  getItemKey: (item: T) => string,
) {
  const collapsedMap = useAtomValue(useAtomValue(sidebarCollapsedAtom));
  const [{ treeParentMap, selectableItems }, setData] = useState(() => {
    return compute(root, collapsedMap);
  });

  const prevRoot = useRef<TreeNode<T> | null>(null);

  useEffect(() => {
    const shouldRecompute =
      root == null || prevRoot.current == null || !equalSubtree(root, prevRoot.current, getItemKey);
    if (!shouldRecompute) return;
    setData(compute(root, collapsedMap));
    prevRoot.current = root;
  }, [collapsedMap, getItemKey, root]);

  return { treeParentMap, selectableItems };
}

function compute<T extends { id: string }>(
  root: TreeNode<T>,
  collapsedMap: Record<string, boolean>,
) {
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
  return { treeParentMap, selectableItems };
}
