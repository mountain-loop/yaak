import type { DragEndEvent, DragMoveEvent, DragStartEvent } from '@dnd-kit/core';
import {
  DndContext,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { type } from '@tauri-apps/plugin-os';
import classNames from 'classnames';
import type { ComponentType, MouseEvent, ReactElement, Ref, RefAttributes } from 'react';
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
import type { HotKeyOptions, HotkeyAction } from '../../../hooks/useHotKey';
import { useHotKey } from '../../../hooks/useHotKey';
import { computeSideForDragMove } from '../../../lib/dnd';
import { jotaiStore } from '../../../lib/jotai';
import type { ContextMenuProps, DropdownItem } from '../Dropdown';
import { ContextMenu } from '../Dropdown';
import {
  collapsedFamily,
  draggingIdsFamily,
  focusIdsFamily,
  hoveredParentFamily,
  isCollapsedFamily,
  selectedIdsFamily,
} from './atoms';
import type { SelectableTreeNode, TreeNode } from './common';
import { closestVisibleNode, equalSubtree, getSelectedItems, hasAncestor } from './common';
import { TreeDragOverlay } from './TreeDragOverlay';
import type { TreeItemClickEvent, TreeItemHandle, TreeItemProps } from './TreeItem';
import type { TreeItemListProps } from './TreeItemList';
import { TreeItemList } from './TreeItemList';
import { useSelectableItems } from './useSelectableItems';

/** So we re-calculate after expanding a folder during drag */
const measuring = { droppable: { strategy: MeasuringStrategy.Always } };

export interface TreeProps<T extends { id: string }> {
  root: TreeNode<T>;
  treeId: string;
  getItemKey: (item: T) => string;
  getContextMenu?: (items: T[]) => ContextMenuProps['items'] | Promise<ContextMenuProps['items']>;
  ItemInner: ComponentType<{ treeId: string; item: T }>;
  ItemLeftSlotInner?: ComponentType<{ treeId: string; item: T }>;
  ItemRightSlot?: ComponentType<{ treeId: string; item: T }>;
  className?: string;
  onActivate?: (item: T) => void;
  onDragEnd?: (opt: { items: T[]; parent: T; children: T[]; insertAt: number }) => void;
  hotkeys?: {
    actions: Partial<Record<HotkeyAction, { cb: (items: T[]) => void } & HotKeyOptions>>;
  };
  getEditOptions?: (item: T) => {
    defaultValue: string;
    placeholder?: string;
    onChange: (item: T, text: string) => void;
  };
}

export interface TreeHandle {
  treeId: string;
  focus: () => boolean;
  hasFocus: () => boolean;
  selectItem: (id: string, focus?: boolean) => void;
  renameItem: (id: string) => void;
  showContextMenu: () => void;
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
    ItemLeftSlotInner,
    ItemRightSlot,
    root,
    treeId,
  }: TreeProps<T>,
  ref: Ref<TreeHandle>,
) {
  const treeRef = useRef<HTMLDivElement>(null);
  const selectableItems = useSelectableItems(root);
  const [showContextMenu, setShowContextMenu] = useState<{
    items: DropdownItem[];
    x: number;
    y: number;
  } | null>(null);
  const treeItemRefs = useRef<Record<string, TreeItemHandle>>({});
  const handleAddTreeItemRef = useCallback((item: T, r: TreeItemHandle | null) => {
    if (r == null) {
      delete treeItemRefs.current[item.id];
    } else {
      treeItemRefs.current[item.id] = r;
    }
  }, []);

  // Select the first item on first render
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only used for initial render
  useEffect(() => {
    const ids = jotaiStore.get(selectedIdsFamily(treeId));
    const fallback = selectableItems[0];
    if (ids.length === 0 && fallback != null) {
      jotaiStore.set(selectedIdsFamily(treeId), [fallback.node.item.id]);
      jotaiStore.set(focusIdsFamily(treeId), {
        anchorId: fallback.node.item.id,
        lastId: fallback.node.item.id,
      });
    }
  }, [treeId]);

  const handleCloseContextMenu = useCallback(() => {
    setShowContextMenu(null);
  }, []);

  const isTreeFocused = useCallback(() => {
    return treeRef.current?.contains(document.activeElement);
  }, []);

  const tryFocus = useCallback(() => {
    const $el = treeRef.current?.querySelector<HTMLButtonElement>(
      '.tree-item button[tabindex="0"]',
    );
    if ($el == null) {
      return false;
    }
    $el.focus();
    $el.scrollIntoView({ block: 'nearest' });
    return true;
  }, []);

  const ensureTabbableItem = useCallback(() => {
    const lastSelectedId = jotaiStore.get(focusIdsFamily(treeId)).lastId;
    const lastSelectedItem = selectableItems.find(
      (i) => i.node.item.id === lastSelectedId && !i.node.hidden,
    );

    // If no item found, default to selecting the first item (prefer leaf node);
    if (lastSelectedItem == null) {
      const firstLeafItem = selectableItems.find((i) => !i.node.hidden && i.node.children == null);
      const firstItem = firstLeafItem ?? selectableItems.find((i) => !i.node.hidden);
      if (firstItem != null) {
        const id = firstItem.node.item.id;
        jotaiStore.set(selectedIdsFamily(treeId), [id]);
        jotaiStore.set(focusIdsFamily(treeId), { anchorId: id, lastId: id });
      }
      return;
    }

    const closest = closestVisibleNode(treeId, lastSelectedItem.node);
    if (closest != null) {
      const id = closest.item.id;
      jotaiStore.set(selectedIdsFamily(treeId), [id]);
      jotaiStore.set(focusIdsFamily(treeId), { anchorId: id, lastId: id });
    }
  }, [selectableItems, treeId]);

  // Ensure there's always a tabbable item after collapsed state changes
  useEffect(() => {
    const unsub = jotaiStore.sub(collapsedFamily(treeId), ensureTabbableItem);
    return unsub;
  }, [ensureTabbableItem, treeId]);

  // Ensure there's always a tabbable item after render
  useEffect(() => {
    requestAnimationFrame(ensureTabbableItem);
  });

  const hasFocus = useCallback(() => {
    return treeRef.current?.contains(document.activeElement) ?? false;
  }, []);

  const setSelected = useCallback(
    (ids: string[], focus: boolean) => {
      jotaiStore.set(selectedIdsFamily(treeId), ids);
      // TODO: Figure out a better way than timeout
      if (!focus) return;
      setTimeout(tryFocus, 50);
    },
    [treeId, tryFocus],
  );

  const treeHandle = useMemo<TreeHandle>(
    () => ({
      treeId,
      focus: tryFocus,
      hasFocus: hasFocus,
      renameItem: (id) => treeItemRefs.current[id]?.rename(),
      selectItem: (id, focus) => {
        if (jotaiStore.get(selectedIdsFamily(treeId)).includes(id)) {
          // Already selected
          return;
        }
        jotaiStore.set(focusIdsFamily(treeId), { anchorId: id, lastId: id });
        setSelected([id], focus === true);
      },
      showContextMenu: async () => {
        if (getContextMenu == null) return;
        const items = getSelectedItems(treeId, selectableItems);
        const menuItems = await getContextMenu(items);
        const lastSelectedId = jotaiStore.get(focusIdsFamily(treeId)).lastId;
        const rect = lastSelectedId ? treeItemRefs.current[lastSelectedId]?.rect() : null;
        if (rect == null) return;
        setShowContextMenu({ items: menuItems, x: rect.x, y: rect.y });
      },
    }),
    [getContextMenu, hasFocus, selectableItems, setSelected, treeId, tryFocus],
  );

  useImperativeHandle(ref, (): TreeHandle => treeHandle, [treeHandle]);

  const handleGetContextMenu = useMemo(() => {
    if (getContextMenu == null) return;
    return (item: T) => {
      const items = getSelectedItems(treeId, selectableItems);
      const isSelected = items.find((i) => i.id === item.id);
      if (isSelected) {
        // If right-clicked an item that was in the multiple-selection, use the entire selection
        return getContextMenu(items);
      }
      // If right-clicked an item that was NOT in the multiple-selection, just use that one
      // Also update the selection with it
      setSelected([item.id], false);
      jotaiStore.set(focusIdsFamily(treeId), (prev) => ({ ...prev, lastId: item.id }));
      return getContextMenu([item]);
    };
  }, [getContextMenu, selectableItems, setSelected, treeId]);

  const handleSelect = useCallback<NonNullable<TreeItemProps<T>['onClick']>>(
    (item, { shiftKey, metaKey, ctrlKey }) => {
      const anchorSelectedId = jotaiStore.get(focusIdsFamily(treeId)).anchorId;
      const selectedIdsAtom = selectedIdsFamily(treeId);
      const selectedIds = jotaiStore.get(selectedIdsAtom);

      // Mark the item as the last one selected
      jotaiStore.set(focusIdsFamily(treeId), (prev) => ({ ...prev, lastId: item.id }));

      if (shiftKey) {
        const validSelectableItems = getValidSelectableItems(treeId, selectableItems);
        const anchorIndex = validSelectableItems.findIndex(
          (i) => i.node.item.id === anchorSelectedId,
        );
        const currIndex = validSelectableItems.findIndex((v) => v.node.item.id === item.id);

        // Nothing was selected yet, so just select this item
        if (selectedIds.length === 0 || anchorIndex === -1 || currIndex === -1) {
          setSelected([item.id], true);
          jotaiStore.set(focusIdsFamily(treeId), (prev) => ({ ...prev, anchorId: item.id }));
          return;
        }

        if (currIndex > anchorIndex) {
          // Selecting down
          const itemsToSelect = validSelectableItems.slice(anchorIndex, currIndex + 1);
          setSelected(
            itemsToSelect.map((v) => v.node.item.id),
            true,
          );
        } else if (currIndex < anchorIndex) {
          // Selecting up
          const itemsToSelect = validSelectableItems.slice(currIndex, anchorIndex + 1);
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

  const selectPrevItem = useCallback(
    (e: TreeItemClickEvent) => {
      const lastSelectedId = jotaiStore.get(focusIdsFamily(treeId)).lastId;
      const validSelectableItems = getValidSelectableItems(treeId, selectableItems);
      const index = validSelectableItems.findIndex((i) => i.node.item.id === lastSelectedId);
      const item = validSelectableItems[index - 1];
      if (item != null) {
        handleSelect(item.node.item, e);
      }
    },
    [handleSelect, selectableItems, treeId],
  );

  const selectNextItem = useCallback(
    (e: TreeItemClickEvent) => {
      const lastSelectedId = jotaiStore.get(focusIdsFamily(treeId)).lastId;
      const validSelectableItems = getValidSelectableItems(treeId, selectableItems);
      const index = validSelectableItems.findIndex((i) => i.node.item.id === lastSelectedId);
      const item = validSelectableItems[index + 1];
      if (item != null) {
        handleSelect(item.node.item, e);
      }
    },
    [handleSelect, selectableItems, treeId],
  );

  const selectParentItem = useCallback(
    (e: TreeItemClickEvent) => {
      const lastSelectedId = jotaiStore.get(focusIdsFamily(treeId)).lastId;
      const lastSelectedItem =
        selectableItems.find((i) => i.node.item.id === lastSelectedId)?.node ?? null;
      if (lastSelectedItem?.parent != null) {
        handleSelect(lastSelectedItem.parent.item, e);
      }
    },
    [handleSelect, selectableItems, treeId],
  );

  useKey(
    (e) => e.key === 'ArrowUp' || e.key.toLowerCase() === 'k',
    (e) => {
      if (!isTreeFocused()) return;
      e.preventDefault();
      selectPrevItem(e);
    },
    undefined,
    [selectableItems, handleSelect],
  );

  useKey(
    (e) => e.key === 'ArrowDown' || e.key.toLowerCase() === 'j',
    (e) => {
      if (!isTreeFocused()) return;
      e.preventDefault();
      selectNextItem(e);
    },
    undefined,
    [selectableItems, handleSelect],
  );

  // If the selected item is a collapsed folder, expand it. Otherwise, select next item
  useKey(
    (e) => e.key === 'ArrowRight' || e.key === 'l',
    (e) => {
      if (!isTreeFocused()) return;
      e.preventDefault();

      const collapsed = jotaiStore.get(collapsedFamily(treeId));
      const lastSelectedId = jotaiStore.get(focusIdsFamily(treeId)).lastId;
      const lastSelectedItem = selectableItems.find((i) => i.node.item.id === lastSelectedId);

      if (
        lastSelectedId &&
        lastSelectedItem?.node.children != null &&
        collapsed[lastSelectedItem.node.item.id] === true
      ) {
        jotaiStore.set(isCollapsedFamily({ treeId, itemId: lastSelectedId }), false);
      } else {
        selectNextItem(e);
      }
    },
    undefined,
    [selectableItems, handleSelect],
  );

  // If the selected item is in a folder, select its parent.
  // If the selected item is an expanded folder, collapse it.
  useKey(
    (e) => e.key === 'ArrowLeft' || e.key === 'h',
    (e) => {
      if (!isTreeFocused()) return;
      e.preventDefault();

      const collapsed = jotaiStore.get(collapsedFamily(treeId));
      const lastSelectedId = jotaiStore.get(focusIdsFamily(treeId)).lastId;
      const lastSelectedItem = selectableItems.find((i) => i.node.item.id === lastSelectedId);

      if (
        lastSelectedId &&
        lastSelectedItem?.node.children != null &&
        collapsed[lastSelectedItem.node.item.id] !== true
      ) {
        jotaiStore.set(isCollapsedFamily({ treeId, itemId: lastSelectedId }), true);
      } else {
        selectParentItem(e);
      }
    },
    { options: {} },
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
        jotaiStore.set(hoveredParentFamily(treeId), {
          parentId: null,
          parentDepth: null,
          childIndex: null,
          index: null,
        });
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
          parentDepth: root.depth,
          index: selectableItems.length,
          childIndex: selectableItems.length,
        });
        return;
      }

      const overSelectableItem = selectableItems.find((i) => i.node.item.id === over.id) ?? null;
      if (overSelectableItem == null) {
        return;
      }

      const draggingItems = jotaiStore.get(draggingIdsFamily(treeId));
      for (const id of draggingItems) {
        const item = selectableItems.find((i) => i.node.item.id === id)?.node ?? null;
        if (item == null) {
          return;
        }

        const isSameParent = item.parent?.item.id === overSelectableItem.node.parent?.item.id;
        if (item.localDrag && !isSameParent) {
          return;
        }
      }

      const node = overSelectableItem.node;
      const side = computeSideForDragMove(node.item.id, e);

      const item = node.item;
      let hoveredParent = node.parent;
      const dragIndex = selectableItems.findIndex((n) => n.node.item.id === item.id) ?? -1;
      const hovered = selectableItems[dragIndex]?.node ?? null;
      const hoveredIndex = dragIndex + (side === 'above' ? 0 : 1);
      let hoveredChildIndex = overSelectableItem.index + (side === 'above' ? 0 : 1);

      // Move into the folder if it's open and we're moving below it
      if (hovered?.children != null && side === 'below') {
        hoveredParent = hovered;
        hoveredChildIndex = 0;
      }

      const parentId = hoveredParent?.item.id ?? null;
      const parentDepth = hoveredParent?.depth ?? null;
      const index = hoveredIndex;
      const childIndex = hoveredChildIndex;
      const existing = jotaiStore.get(hoveredParentFamily(treeId));
      if (
        !(
          parentId === existing.parentId &&
          parentDepth === existing.parentDepth &&
          index === existing.index &&
          childIndex === existing.childIndex
        )
      ) {
        jotaiStore.set(hoveredParentFamily(treeId), {
          parentId,
          parentDepth,
          index,
          childIndex,
        });
      }
    },
    [root.depth, root.item.id, selectableItems, treeId],
  );

  const handleDragStart = useCallback(
    function handleDragStart(e: DragStartEvent) {
      const selectedItems = getSelectedItems(treeId, selectableItems);
      const isDraggingSelectedItem = selectedItems.find((i) => i.id === e.active.id);

      // If we started dragging an already-selected item, we'll use that
      if (isDraggingSelectedItem) {
        jotaiStore.set(
          draggingIdsFamily(treeId),
          selectedItems.map((i) => i.id),
        );
      } else {
        // If we started dragging a non-selected item, only drag that item
        const activeItem = selectableItems.find((i) => i.node.item.id === e.active.id)?.node.item;
        if (activeItem != null) {
          jotaiStore.set(draggingIdsFamily(treeId), [activeItem.id]);
          // Also update selection to just be this one
          handleSelect(activeItem, {
            shiftKey: false,
            metaKey: false,
            ctrlKey: false,
          });
        }
      }
    },
    [handleSelect, selectableItems, treeId],
  );

  const clearDragState = useCallback(() => {
    jotaiStore.set(hoveredParentFamily(treeId), {
      parentId: null,
      parentDepth: null,
      index: null,
      childIndex: null,
    });
    jotaiStore.set(draggingIdsFamily(treeId), []);
  }, [treeId]);

  const handleDragEnd = useCallback(
    function handleDragEnd(e: DragEndEvent) {
      // Get this from the store so our callback doesn't change all the time
      const {
        index: hoveredIndex,
        parentId: hoveredParentId,
        childIndex: hoveredChildIndex,
      } = jotaiStore.get(hoveredParentFamily(treeId));
      const draggingItems = jotaiStore.get(draggingIdsFamily(treeId));
      clearDragState();

      // Dropped outside the tree?
      if (e.over == null) {
        return;
      }

      const hoveredParentS =
        hoveredParentId === root.item.id
          ? { node: root, depth: 0, index: 0 }
          : (selectableItems.find((i) => i.node.item.id === hoveredParentId) ?? null);
      const hoveredParent = hoveredParentS?.node ?? null;

      if (hoveredParent == null || hoveredIndex == null || !draggingItems?.length) {
        return;
      }

      // Resolve the actual tree nodes for each dragged item (keeps order of draggingItems)
      const draggedNodes: TreeNode<T>[] = draggingItems
        .map((id) => {
          return selectableItems.find((i) => i.node.item.id === id)?.node ?? null;
        })
        .filter((n) => n != null)
        // Filter out invalid drags (dragging into descendant)
        .filter(
          (n) => hoveredParent.item.id !== n.item.id && !hasAncestor(hoveredParent, n.item.id),
        );

      // Work on a local copy of target children
      const nextChildren = [...(hoveredParent.children ?? [])];

      // Remove any of the dragged nodes already in the target, adjusting hoveredIndex
      let insertAt = hoveredChildIndex ?? 0;
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
    [treeId, clearDragState, selectableItems, root, onDragEnd],
  );

  const treeItemListProps: Omit<
    TreeItemListProps<T>,
    'nodes' | 'treeId' | 'activeIdAtom' | 'hoveredParent' | 'hoveredIndex'
  > = {
    getItemKey,
    getContextMenu: handleGetContextMenu,
    onClick: handleClick,
    getEditOptions,
    ItemInner,
    ItemLeftSlotInner,
    ItemRightSlot,
  };

  const handleContextMenu = useCallback(
    async (e: MouseEvent<HTMLElement>) => {
      if (getContextMenu == null) return;

      e.preventDefault();
      e.stopPropagation();
      const items = await getContextMenu([]);
      setShowContextMenu({ items, x: e.clientX, y: e.clientY });
    },
    [getContextMenu],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  return (
    <>
      <TreeHotKeys treeId={treeId} hotkeys={hotkeys} selectableItems={selectableItems} />
      {showContextMenu && (
        <ContextMenu
          items={showContextMenu.items}
          triggerPosition={showContextMenu}
          onClose={handleCloseContextMenu}
        />
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={clearDragState}
        onDragAbort={clearDragState}
        onDragMove={handleDragMove}
        measuring={measuring}
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
          <div
            className={classNames(
              '[&_.tree-item.selected_.tree-item-inner]:text-text',
              '[&:focus-within]:[&_.tree-item.selected]:bg-surface-active',
              '[&:not(:focus-within)]:[&_.tree-item.selected:not([data-context-menu-open])]:bg-surface-highlight',
              '[&_.tree-item.selected[data-context-menu-open]]:bg-surface-active',
              // Round the items, but only if the ends of the selection.
              // Also account for the drop marker being in between items
              '[&_.tree-item]:rounded-md',
              '[&_.tree-item.selected+.tree-item.selected]:rounded-t-none',
              '[&_.tree-item.selected+.drop-marker+.tree-item.selected]:rounded-t-none',
              '[&_.tree-item.selected:has(+.tree-item.selected)]:rounded-b-none',
              '[&_.tree-item.selected:has(+.drop-marker+.tree-item.selected)]:rounded-b-none',
            )}
          >
            <TreeItemList
              addTreeItemRef={handleAddTreeItemRef}
              nodes={selectableItems}
              treeId={treeId}
              {...treeItemListProps}
            />
          </div>
          {/* Assign root ID so we can reuse our same move/end logic */}
          <DropRegionAfterList id={root.item.id} onContextMenu={handleContextMenu} />
        </div>
        <TreeDragOverlay
          treeId={treeId}
          selectableItems={selectableItems}
          ItemInner={ItemInner}
          getItemKey={getItemKey}
        />
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

function DropRegionAfterList({
  id,
  onContextMenu,
}: {
  id: string;
  onContextMenu?: (e: MouseEvent<HTMLDivElement>) => void;
}) {
  const { setNodeRef } = useDroppable({ id });
  // biome-ignore lint/a11y/noStaticElementInteractions: Meh
  return <div ref={setNodeRef} onContextMenu={onContextMenu} />;
}

interface TreeHotKeyProps<T extends { id: string }> {
  action: HotkeyAction;
  selectableItems: SelectableTreeNode<T>[];
  treeId: string;
  onDone: (items: T[]) => void;
  priority?: number;
  enable?: boolean | (() => boolean);
}

function TreeHotKey<T extends { id: string }>({
  treeId,
  action,
  onDone,
  selectableItems,
  enable,
  ...options
}: TreeHotKeyProps<T>) {
  useHotKey(
    action,
    () => {
      onDone(getSelectedItems(treeId, selectableItems));
    },
    {
      ...options,
      enable: () => {
        if (enable == null) return true;
        if (typeof enable === 'function') return enable();
        return enable;
      },
    },
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
      {Object.entries(hotkeys.actions).map(([hotkey, { cb, ...options }]) => (
        <TreeHotKey
          key={hotkey}
          action={hotkey as HotkeyAction}
          treeId={treeId}
          onDone={cb}
          selectableItems={selectableItems}
          {...options}
        />
      ))}
    </>
  );
}

function getValidSelectableItems<T extends { id: string }>(
  treeId: string,
  selectableItems: SelectableTreeNode<T>[],
) {
  const collapsed = jotaiStore.get(collapsedFamily(treeId));
  return selectableItems.filter((i) => {
    if (i.node.hidden) return false;
    let p = i.node.parent;
    while (p) {
      if (collapsed[p.item.id]) return false;
      p = p.parent;
    }
    return true;
  });
}
