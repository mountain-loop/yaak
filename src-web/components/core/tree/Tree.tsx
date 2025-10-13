import type { DragEndEvent, DragMoveEvent, DragStartEvent } from '@dnd-kit/core';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import classNames from 'classnames';
import type { Atom } from 'jotai';
import { useAtom, useAtomValue } from 'jotai';
import type { ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useKey, useKeyPressEvent } from 'react-use';
import { sidebarCollapsedAtom } from '../../../hooks/useSidebarItemCollapsed';
import { jotaiStore } from '../../../lib/jotai';
import type { ContextMenuProps } from '../Dropdown';
import { draggingIdsFamily, focusIdsFamily, hoveredParentFamily, selectedIdsFamily } from './atoms';
import type { SelectableTreeNode, TreeNode } from './common';
import { computeSideForDragMove, equalSubtree, getSelectedItems, hasAncestor } from './common';
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
  onDragEnd?: (opt: { items: T[]; parent: T; children: T[]; insertAt: number }) => void;
  getEditOptions?: (item: T) => {
    defaultValue: string;
    placeholder?: string;
    onChange: (item: T, text: string) => void;
  };
}

function Tree_<T extends { id: string }>({
  activeIdAtom,
  className,
  getContextMenu,
  getEditOptions,
  getItemKey,
  onActivate,
  onDragEnd,
  renderItem,
  renderLeftSlot,
  root,
  treeId,
}: TreeProps<T>) {
  const treeRef = useRef<HTMLDivElement>(null);
  const [draggingItems, setDraggingItems] = useAtom(draggingIdsFamily(treeId));
  const [hasFocus, setHasFocus] = useState<boolean>(false);
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
        jotaiStore.set(focusIdsFamily(treeId), (prev) => ({ ...prev, lastId: item.id }));
        return getContextMenu([item]);
      }
    };
  }, [getContextMenu, selectableItems, treeId]);

  const handleSelect = useCallback<NonNullable<TreeItemProps<T>['onClick']>>(
    (item, { shiftKey, metaKey, ctrlKey }) => {
      setHasFocus(true);
      jotaiStore.set(focusIdsFamily(treeId), (prev) => ({ ...prev, lastId: item.id }));
      const anchorSelectedId = jotaiStore.get(focusIdsFamily(treeId)).anchorId;
      const selectedIdsAtom = selectedIdsFamily(treeId);
      const selectedIds = jotaiStore.get(selectedIdsAtom);

      if (shiftKey) {
        // Nothing was selected yet, so just select this item
        const anchorIndex = selectableItems.findIndex((i) => i.node.item.id === anchorSelectedId);
        const currIndex = selectableItems.findIndex((v) => v.node.item.id === item.id);
        if (selectedIds.length === 0 || anchorIndex === -1 || currIndex === -1) {
          jotaiStore.set(selectedIdsAtom, [item.id]);
          jotaiStore.set(focusIdsFamily(treeId), (prev) => ({ ...prev, anchorId: item.id }));
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
        jotaiStore.set(focusIdsFamily(treeId), (prev) => ({ ...prev, anchorId: item.id }));
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
      const lastSelectedId = jotaiStore.get(focusIdsFamily(treeId)).lastId;
      const index = selectableItems.findIndex((i) => i.node.item.id === lastSelectedId);
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
      const lastSelectedId = jotaiStore.get(focusIdsFamily(treeId)).lastId;
      const index = selectableItems.findIndex((i) => i.node.item.id === lastSelectedId);
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

  useKeyPressEvent('Escape', async () => {
    clearDragState();
  });

  const handleDragMove = useCallback(
    function handleMove(e: DragMoveEvent) {
      const over = e.over;
      if (!over) {
        // Clear the drop indicator when hovering outside the tree
        jotaiStore.set(hoveredParentFamily(treeId), { parentId: null, index: null });
        return;
      }

      // Not sure when or if this happens
      if (e.active.rect.current.initial == null) {
        return;
      }

      const node = selectableItems.find((i) => i.node.item.id === e.over?.id)?.node ?? null;
      if (node == null) return;

      const side = computeSideForDragMove(node, e);

      const item = node.item;
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

      jotaiStore.set(hoveredParentFamily(treeId), {
        parentId: hoveredParent?.item.id ?? null,
        index: hoveredIndex,
      });
    },
    [selectableItems, treeId, treeParentMap],
  );

  const handleDragStart = useCallback(
    function handleDragStart(e: DragStartEvent) {
      const item = selectableItems.find((i) => i.node.item.id === e.active.id)?.node.item ?? null;
      if (item == null) return;

      const selectedItems = getSelectedItems(treeId, selectableItems);
      const isDraggingSelectedItem = selectedItems.find((i) => i.id === item.id);
      if (isDraggingSelectedItem) {
        setDraggingItems(selectedItems.map((i) => i.id));
      } else {
        setDraggingItems([item.id]);
        // Also update selection to just be this one
        handleSelect(item, { shiftKey: false, metaKey: false, ctrlKey: false });
      }
    },
    [handleSelect, selectableItems, setDraggingItems, treeId],
  );

  const clearDragState = useCallback(() => {
    jotaiStore.set(hoveredParentFamily(treeId), { parentId: null, index: null });
    jotaiStore.set(draggingIdsFamily(treeId), []);
  }, [treeId]);

  const handleDragEnd = useCallback(
    function handleDragEnd(e: DragEndEvent) {
      // Get this from the store so our callback doesn't change all the time
      const hovered = jotaiStore.get(hoveredParentFamily(treeId));
      const draggingItems = jotaiStore.get(draggingIdsFamily(treeId));
      clearDragState();

      // Dropped outside the tree?
      if (e.over == null) return;

      const hoveredParent =
        hovered.parentId == root.item.id
          ? root
          : selectableItems.find((n) => n.node.item.id === hovered.parentId)?.node;

      if (hoveredParent == null || hovered.index == null || !draggingItems?.length) return;

      // Optional tiny guard: don't drop into itself
      if (draggingItems.some((id) => id === hovered.parentId)) return;

      // Resolve the actual tree nodes for each dragged item (keeps order of draggingItems)
      const draggedNodes: TreeNode<T>[] = draggingItems
        .map((id) => {
          const parent = treeParentMap[id];
          const idx = parent?.children?.findIndex((n) => n.item.id === id) ?? -1;
          return idx >= 0 ? parent!.children![idx]! : null;
        })
        .filter((n) => n != null)
        // Filter out invalid drags (dragging into descendant)
        .filter((n) => !hasAncestor(hoveredParent, n.item.id));

      // Work on a local copy of target children
      const nextChildren = [...(hoveredParent.children ?? [])];

      // Remove any of the dragged nodes already in the target, adjusting hoveredIndex
      let insertAt = hovered.index;
      for (const node of draggedNodes) {
        const i = nextChildren.findIndex((n) => n.item.id === node.item.id);
        if (i !== -1) {
          nextChildren.splice(i, 1);
          if (i < insertAt) insertAt -= 1; // account for removed-before
        }
      }

      // Batch callback
      onDragEnd?.({
        items: draggedNodes.map((n) => n.item),
        parent: hoveredParent.item,
        children: nextChildren.map((c) => c.item),
        insertAt,
      });
    },
    [treeId, clearDragState, root, selectableItems, onDragEnd, treeParentMap],
  );

  const treeItemProps: Omit<
    TreeItemListProps<T>,
    'node' | 'treeId' | 'activeIdAtom' | 'hoveredParent' | 'hoveredIndex'
  > = {
    depth: 0,
    getItemKey: getItemKey,
    getContextMenu: handleGetContextMenu,
    onClick: handleClick,
    getEditOptions,
    renderItem: renderItem,
    renderLeftSlot: renderLeftSlot,
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={clearDragState}
      onDragAbort={clearDragState}
      onDragMove={handleDragMove}
      autoScroll
    >
      <div
        ref={treeRef}
        className={classNames(
          className,
          'outline-none h-full',
          'overflow-y-auto overflow-x-hidden',
          'grid grid-rows-[auto_1fr]',
        )}
      >
        <TreeItemList node={root} treeId={treeId} activeIdAtom={activeIdAtom} {...treeItemProps} />
        <DropRegionAfterList treeId={treeId} />
      </div>
      <DragOverlay dropAnimation={null}>
        <TreeItemList
          treeId={treeId + '.dragging'}
          style={{ width: treeRef.current?.clientWidth ?? undefined }}
          node={{
            item: { ...root.item, id: `${root.item.id}_dragging` },
            parent: null,
            children: draggingItems.map((id) => {
              const child = selectableItems.find((i2) => i2.node.item.id === id)!.node;
              // Remove children so we don't render them in the drag preview
              return { ...child, children: undefined };
            }),
          }}
          {...treeItemProps}
        />
      </DragOverlay>
    </DndContext>
  );
}

function DropRegionAfterList({ treeId }: { treeId: string }) {
  const { setNodeRef } = useDroppable({
    id: treeId,
  });
  return <div className="bg-info opacity-10 h-full" ref={setNodeRef} />;
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
