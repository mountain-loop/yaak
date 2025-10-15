import type { DragEndEvent, DragMoveEvent, DragStartEvent } from '@dnd-kit/core';
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { type } from '@tauri-apps/plugin-os';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import type { ComponentType, ReactElement, Ref, RefAttributes } from 'react';
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useKey, useKeyPressEvent } from 'react-use';
import type { HotkeyAction, HotKeyOptions } from '../../../hooks/useHotKey';
import { useHotKey } from '../../../hooks/useHotKey';
import { sidebarCollapsedAtom } from '../../../hooks/useSidebarItemCollapsed';
import { jotaiStore } from '../../../lib/jotai';
import type { ContextMenuProps } from '../Dropdown';
import { draggingIdsFamily, focusIdsFamily, hoveredParentFamily, selectedIdsFamily } from './atoms';
import type { SelectableTreeNode, TreeNode } from './common';
import { computeSideForDragMove, equalSubtree, getSelectedItems, hasAncestor } from './common';
import { TreeDragOverlay } from './TreeDragOverlay';
import type { TreeItemProps } from './TreeItem';
import type { TreeItemListProps } from './TreeItemList';
import { TreeItemList } from './TreeItemList';

export interface TreeProps<T extends { id: string }> {
  root: TreeNode<T>;
  treeId: string;
  getItemKey: (item: T) => string;
  getContextMenu?: (items: T[]) => Promise<ContextMenuProps['items']>;
  ItemInner: ComponentType<{ treeId: string; item: T }>;
  ItemLeftSlot?: ComponentType<{ treeId: string; item: T }>;
  className?: string;
  onActivate?: (item: T) => void;
  onDragEnd?: (opt: { items: T[]; parent: T; children: T[]; insertAt: number }) => void;
  hotkeys?: { actions: Partial<Record<HotkeyAction, (items: T[]) => void>> } & HotKeyOptions;
  getEditOptions?: (item: T) => {
    defaultValue: string;
    placeholder?: string;
    onChange: (item: T, text: string) => void;
  };
}

export interface TreeHandle {
  focus: () => void;
  selectItem: (id: string) => void;
}

function TreeInner<T extends { id: string }>(
  {
    className,
    getContextMenu,
    getEditOptions,
    getItemKey,
    hotkeys,
    onActivate,
    onDragEnd,
    ItemInner,
    ItemLeftSlot,
    root,
    treeId,
  }: TreeProps<T>,
  ref: Ref<TreeHandle>,
) {
  const treeRef = useRef<HTMLDivElement>(null);
  const { treeParentMap, selectableItems } = useTreeParentMap(root, getItemKey);
  const [isFocused, setIsFocused] = useState<boolean>(false);

  const tryFocus = useCallback(() => {
    treeRef.current?.querySelector<HTMLButtonElement>('.tree-item button[tabindex="0"]')?.focus();
  }, []);

  const setSelected = useCallback(
    function setSelected(ids: string[], focus: boolean) {
      jotaiStore.set(selectedIdsFamily(treeId), ids);
      // TODO: Figure out a better way than timeout
      if (focus) setTimeout(tryFocus, 50);
    },
    [treeId, tryFocus],
  );

  useImperativeHandle(
    ref,
    (): TreeHandle => ({
      focus: tryFocus,
      selectItem(id) {
        setSelected([id], false);
        jotaiStore.set(focusIdsFamily(treeId), { anchorId: id, lastId: id });
      },
    }),
    [setSelected, treeId, tryFocus],
  );

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
      const anchorSelectedId = jotaiStore.get(focusIdsFamily(treeId)).anchorId;
      const selectedIdsAtom = selectedIdsFamily(treeId);
      const selectedIds = jotaiStore.get(selectedIdsAtom);

      // Mark item as the last one selected
      jotaiStore.set(focusIdsFamily(treeId), (prev) => ({ ...prev, lastId: item.id }));

      if (shiftKey) {
        const anchorIndex = selectableItems.findIndex((i) => i.node.item.id === anchorSelectedId);
        const currIndex = selectableItems.findIndex((v) => v.node.item.id === item.id);
        // Nothing was selected yet, so just select this item
        if (selectedIds.length === 0 || anchorIndex === -1 || currIndex === -1) {
          setSelected([item.id], true);
          jotaiStore.set(focusIdsFamily(treeId), (prev) => ({ ...prev, anchorId: item.id }));
          return;
        }

        if (currIndex > anchorIndex) {
          // Selecting down
          const itemsToSelect = selectableItems.slice(anchorIndex, currIndex + 1);
          setSelected(
            itemsToSelect.map((v) => v.node.item.id),
            true,
          );
        } else if (currIndex < anchorIndex) {
          // Selecting up
          const itemsToSelect = selectableItems.slice(currIndex, anchorIndex + 1);
          setSelected(
            itemsToSelect.map((v) => v.node.item.id),
            true,
          );
        } else {
          setSelected([item.id], true);
        }
      } else if (type() === 'macos' ? metaKey : ctrlKey) {
        const withoutCurr = selectedIds.filter((id) => id !== item.id);
        if (withoutCurr.length === selectedIds.length) {
          // It wasn't in there, so add it
          setSelected([...selectedIds, item.id], true);
        } else {
          // It was in there, so remove it
          setSelected(withoutCurr, true);
        }
      } else {
        // Select single
        setSelected([item.id], true);
        jotaiStore.set(focusIdsFamily(treeId), (prev) => ({ ...prev, anchorId: item.id }));
      }
    },
    [selectableItems, setSelected, treeId],
  );

  const handleClick = useCallback<NonNullable<TreeItemProps<T>['onClick']>>(
    (item, e) => {
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        handleSelect(item, e);
      } else {
        handleSelect(item, e);
        onActivate?.(item);
      }
    },
    [handleSelect, onActivate],
  );

  useKey(
    'ArrowUp',
    (e) => {
      if (!treeRef.current?.contains(document.activeElement)) return;
      e.preventDefault();
      const lastSelectedId = jotaiStore.get(focusIdsFamily(treeId)).lastId;
      const index = selectableItems.findIndex((i) => i.node.item.id === lastSelectedId);
      const item = selectableItems[index - 1];
      if (item != null) handleSelect(item.node.item, e);
    },
    undefined,
    [selectableItems, handleSelect],
  );

  useKey(
    'ArrowDown',
    (e) => {
      if (!treeRef.current?.contains(document.activeElement)) return;
      e.preventDefault();
      const lastSelectedId = jotaiStore.get(focusIdsFamily(treeId)).lastId;
      const index = selectableItems.findIndex((i) => i.node.item.id === lastSelectedId);
      const item = selectableItems[index + 1];
      if (item != null) handleSelect(item.node.item, e);
    },
    undefined,
    [selectableItems, handleSelect],
  );

  useKeyPressEvent('Escape', async () => {
    if (!treeRef.current?.contains(document.activeElement)) return;
    clearDragState();
    const lastSelectedId = jotaiStore.get(focusIdsFamily(treeId)).lastId;
    if (lastSelectedId == null) return;
    setSelected([lastSelectedId], false);
  });

  const handleDragMove = useCallback(
    function handleDragMove(e: DragMoveEvent) {
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

      // Root is anything past the end of the list, so set it to the end
      const hoveringRoot = over.id === root.item.id;
      if (hoveringRoot) {
        jotaiStore.set(hoveredParentFamily(treeId), {
          parentId: root.item.id,
          index: root.children?.length ?? 0,
        });
        return;
      }

      const node = selectableItems.find((i) => i.node.item.id === over.id)?.node ?? null;
      if (node == null) {
        return;
      }

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
    [root.children?.length, root.item.id, selectableItems, treeId, treeParentMap],
  );

  const handleDragStart = useCallback(
    function handleDragStart(e: DragStartEvent) {
      const item = selectableItems.find((i) => i.node.item.id === e.active.id)?.node.item ?? null;
      if (item == null) return;

      const selectedItems = getSelectedItems(treeId, selectableItems);
      const isDraggingSelectedItem = selectedItems.find((i) => i.id === item.id);
      if (isDraggingSelectedItem) {
        jotaiStore.set(
          draggingIdsFamily(treeId),
          selectedItems.map((i) => i.id),
        );
      } else {
        jotaiStore.set(draggingIdsFamily(treeId), [item.id]);
        // Also update selection to just be this one
        handleSelect(item, { shiftKey: false, metaKey: false, ctrlKey: false });
      }
    },
    [handleSelect, selectableItems, treeId],
  );

  const clearDragState = useCallback(() => {
    jotaiStore.set(hoveredParentFamily(treeId), { parentId: null, index: null });
    // jotaiStore.set(draggingIdsFamily(treeId), []);
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

  const treeItemListProps: Omit<
    TreeItemListProps<T>,
    'node' | 'treeId' | 'activeIdAtom' | 'hoveredParent' | 'hoveredIndex'
  > = {
    depth: 0,
    getItemKey,
    getContextMenu: handleGetContextMenu,
    onClick: handleClick,
    getEditOptions,
    ItemInner,
    ItemLeftSlot,
  };

  const handleFocus = useCallback(function handleFocus() {
    setIsFocused(true);
  }, []);

  const handleBlur = useCallback(function handleBlur() {
    setIsFocused(false);
  }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  return (
    <>
      <TreeHotKeys treeId={treeId} hotkeys={hotkeys} selectableItems={selectableItems} />
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
          onFocus={handleFocus}
          onBlur={handleBlur}
          className={classNames(
            className,
            'outline-none h-full',
            'overflow-y-auto overflow-x-hidden',
            'grid grid-rows-[auto_1fr]',
            ' [&_.tree-item.selected]:text-text',
            isFocused
              ? '[&_.tree-item.selected]:bg-surface-active'
              : '[&_.tree-item.selected]:bg-surface-highlight',
          )}
        >
          <TreeItemList node={root} treeId={treeId} {...treeItemListProps} />
          {/* Assign root ID so we can reuse our same move/end logic */}
          <DropRegionAfterList id={root.item.id} />
          <TreeDragOverlay
            treeId={treeId}
            root={root}
            selectableItems={selectableItems}
            ItemInner={ItemInner}
            getItemKey={getItemKey}
          />
        </div>
      </DndContext>
    </>
  );
}

// 1) Preserve generics through forwardRef:
const Tree_ = forwardRef(TreeInner) as <T extends { id: string }>(
  props: TreeProps<T> & RefAttributes<TreeHandle>,
) => ReactElement | null;

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

function DropRegionAfterList({ id }: { id: string }) {
  const { setNodeRef } = useDroppable({ id });
  return <div ref={setNodeRef} />;
}

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
    // console.log("IS COLLAPSED", node.item.name, isCollapsed);
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

interface TreeHotKeyProps<T extends { id: string }> extends HotKeyOptions {
  action: HotkeyAction;
  selectableItems: SelectableTreeNode<T>[];
  treeId: string;
  onDone: (items: T[]) => void;
}

function TreeHotKey<T extends { id: string }>({
  treeId,
  action,
  onDone,
  selectableItems,
  ...options
}: TreeHotKeyProps<T>) {
  useHotKey(
    action,
    () => {
      onDone(getSelectedItems(treeId, selectableItems));
    },
    options,
  );
  return null;
}

function TreeHotKeys<T extends { id: string }>({
  treeId,
  hotkeys,
  selectableItems,
}: {
  treeId: string;
  hotkeys: TreeProps<T>['hotkeys'];
  selectableItems: SelectableTreeNode<T>[];
}) {
  if (hotkeys == null) return null;

  return (
    <>
      {Object.entries(hotkeys.actions).map(([hotkey, onDone]) => (
        <TreeHotKey
          key={hotkey}
          action={hotkey as HotkeyAction}
          priority={hotkeys.priority}
          enable={hotkeys.enable}
          treeId={treeId}
          onDone={onDone}
          selectableItems={selectableItems}
        />
      ))}
    </>
  );
}
