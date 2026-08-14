import type { DragEndEvent, DragMoveEvent, DragStartEvent } from "@dnd-kit/core";
import type { Virtualizer } from "@tanstack/react-virtual";
import {
  DndContext,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { platform } from "@yaakapp-internal/platform";
import classNames from "classnames";
import type { ComponentType, MouseEvent, ReactElement, Ref, RefAttributes } from "react";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useKey, useKeyPressEvent } from "react-use";
import { computeSideForDragMove } from "../../lib/dnd";
import { useAtomValue, useStore } from "jotai";
import { draggingIdsFamily, focusIdsFamily, hoveredParentFamily, selectedIdsFamily } from "./atoms";
import { type CollapsedAtom, CollapsedAtomContext } from "./context";
import type { ContextMenuRenderer, TreeNode } from "./common";
import { closestVisibleNode, equalSubtree, getSelectedItems, hasAncestor } from "./common";
import { TreeDragOverlay } from "./TreeDragOverlay";
import type { TreeItemClickEvent, TreeItemHandle, TreeItemProps } from "./TreeItem";
import type { TreeItemListProps } from "./TreeItemList";
import { TreeItemList } from "./TreeItemList";
import { useSelectableItems } from "./useSelectableItems";

/** So we re-calculate after expanding a folder during drag */
const measuring = { droppable: { strategy: MeasuringStrategy.Always } };

export interface TreeProps<T extends { id: string }> {
  root: TreeNode<T>;
  treeId: string;
  collapsedAtom: CollapsedAtom;
  getItemKey: (item: T) => string;
  getContextMenu?: (items: T[]) => unknown[] | Promise<unknown[]>;
  renderContextMenu?: ContextMenuRenderer;
  ItemInner: ComponentType<{ treeId: string; item: T }>;
  ItemLeftSlotInner?: ComponentType<{ treeId: string; item: T }>;
  ItemRightSlot?: ComponentType<{ treeId: string; item: T }>;
  className?: string;
  onActivate?: (item: T) => void;
  onDragEnd?: (opt: { items: T[]; parent: T; children: T[]; insertAt: number }) => void;
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
  getSelectedItems: () => { id: string }[];
  selectItem: (id: string, focus?: boolean) => void;
  renameItem: (id: string) => void;
  showContextMenu: () => void;
}

function TreeInner<T extends { id: string }>(
  {
    className,
    collapsedAtom,
    getContextMenu,
    getEditOptions,
    getItemKey,
    onActivate,
    onDragEnd,
    renderContextMenu,
    ItemInner,
    ItemLeftSlotInner,
    ItemRightSlot,
    root,
    treeId,
  }: TreeProps<T>,
  ref: Ref<TreeHandle>,
) {
  const store = useStore();
  const treeRef = useRef<HTMLDivElement>(null);
  const virtualizerRef = useRef<Virtualizer<HTMLElement, Element> | null>(null);

  // The scroll container is tracked in state as well as a ref, so the virtualizer re-resolves it
  // once it exists. React attaches refs and runs layout effects child-first, so TreeItemList's
  // effects run before this ancestor's ref is set: on a fresh mount a ref-only getScrollElement
  // returns null, and the virtualizer renders nothing until some later render happens to wake it
  // up. Usually one does, which is why this only showed when the tree remounted into settled data
  // (filtering down to no results and back).
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const setTreeRef = useCallback((el: HTMLDivElement | null) => {
    treeRef.current = el;
    setScrollEl(el);
  }, []);
  const getScrollElement = useCallback(() => scrollEl, [scrollEl]);
  const handleVirtualizerReady = useCallback((v: Virtualizer<HTMLElement, Element>) => {
    virtualizerRef.current = v;
  }, []);
  const selectableItems = useSelectableItems(root);

  // Only render nodes that are actually visible (not filtered out, and not
  // inside a collapsed folder). Mounting every node regardless of visibility
  // makes large workspaces unusable: thousands of hidden TreeItems each run
  // their dnd/context hooks on every tree commit just to return null.
  const collapsedMap = useAtomValue(collapsedAtom);
  const visibleItems = useMemo(() => {
    return selectableItems.filter((i) => {
      if (i.node.hidden) return false;
      for (let p = i.node.parent; p != null; p = p.parent) {
        if (collapsedMap[p.item.id]) return false;
      }
      return true;
    });
  }, [selectableItems, collapsedMap]);
  const [showContextMenu, setShowContextMenu] = useState<{
    items: unknown[];
    x: number;
    y: number;
  } | null>(null);
  const treeItemRefs = useRef<Record<string, TreeItemHandle>>({});
  const handleAddTreeItemRef = useCallback((item: T, r: TreeItemHandle | null) => {
    if (r == null) {
      delete treeItemRefs.current[item.id];

      // Keep keyboard focus inside the tree when the focused row is virtualized away.
      //
      // Scrolling the focused row out of the window destroys the button holding focus, and the
      // browser drops focus to the body rather than moving it anywhere. Everything keyboard-driven
      // is gated on the tree containing document.activeElement (arrow navigation here, rename,
      // delete, duplicate and the context menu in the consumer), so the entire keyboard interface
      // would go dead until the user clicked a row again. They all act on the selected id rather
      // than the focused element, so parking focus on the container is enough to keep them live.
      //
      // NOTE: This has to hang off the unmount rather than a render or a focusout. Scrolling
      //  re-renders the list, not this component, and removing a focused element doesn't reliably
      //  fire focusout.
      requestAnimationFrame(() => {
        const el = treeRef.current;
        if (el == null) return;
        const active = document.activeElement;
        const focusWasDropped = active == null || active === document.body || !active.isConnected;
        if (focusWasDropped) {
          el.focus({ preventScroll: true });
        }
      });
    } else {
      treeItemRefs.current[item.id] = r;
    }
  }, []);

  // Select the first item on first render
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only used for initial render
  useEffect(() => {
    const ids = store.get(selectedIdsFamily(treeId));
    const fallback = selectableItems[0];
    if (ids.length === 0 && fallback != null) {
      store.set(selectedIdsFamily(treeId), [fallback.node.item.id]);
      store.set(focusIdsFamily(treeId), {
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
    const find = () =>
      treeRef.current?.querySelector<HTMLButtonElement>('.tree-item button[tabindex="0"]');
    const $el = find();
    if ($el != null) {
      // preventScroll so scrolling stays single-sourced (focus() implicitly
      // scrolls, which fights the virtualizer's scrollToIndex)
      $el.focus({ preventScroll: true });
      $el.scrollIntoView({ block: "nearest" });
      return true;
    }

    // The focused row may be virtualized out of range. Scroll it into range,
    // then focus it once it has mounted.
    const lastFocusedId = store.get(focusIdsFamily(treeId)).lastId;
    const index = visibleItems.findIndex((i) => i.node.item.id === lastFocusedId);
    if (index < 0) {
      return false;
    }
    virtualizerRef.current?.scrollToIndex(index, { align: "auto" });
    requestAnimationFrame(() => find()?.focus({ preventScroll: true }));
    return true;
  }, [store, treeId, visibleItems]);

  const ensureTabbableItem = useCallback(() => {
    const lastSelectedId = store.get(focusIdsFamily(treeId)).lastId;
    const lastSelectedItem = selectableItems.find(
      (i) => i.node.item.id === lastSelectedId && !i.node.hidden,
    );

    // If no item found, default to selecting the first item (prefer leaf node);
    if (lastSelectedItem == null) {
      const firstLeafItem = selectableItems.find((i) => !i.node.hidden && i.node.children == null);
      const firstItem = firstLeafItem ?? selectableItems.find((i) => !i.node.hidden);
      if (firstItem != null) {
        const id = firstItem.node.item.id;
        store.set(selectedIdsFamily(treeId), [id]);
        store.set(focusIdsFamily(treeId), { anchorId: id, lastId: id });
      }
      return;
    }

    const closest = closestVisibleNode(store, collapsedAtom, lastSelectedItem.node);
    if (closest != null) {
      const id = closest.item.id;
      store.set(selectedIdsFamily(treeId), [id]);
      store.set(focusIdsFamily(treeId), { anchorId: id, lastId: id });
    }
  }, [selectableItems, treeId]);

  // Ensure there's always a tabbable item after collapsed state changes
  useEffect(() => {
    const unsub = store.sub(collapsedAtom, ensureTabbableItem);
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
      store.set(selectedIdsFamily(treeId), ids);
      // TODO: Figure out a better way than timeout
      if (!focus) return;
      setTimeout(tryFocus, 50);
    },
    [treeId, tryFocus],
  );

  /**
   * Run something against a row's handle, scrolling the row into view first when it isn't
   * mounted.
   *
   * Virtualized rows only have a handle while they're in the window, but the row these act on is
   * the selected one, which the user is free to scroll away from before hitting a hotkey. Without
   * this, renaming an off-screen row silently does nothing and the context menu has no rect to
   * open against.
   */
  const withTreeItem = useCallback(
    (id: string, action: (handle: TreeItemHandle) => void) => {
      const mounted = treeItemRefs.current[id];
      if (mounted != null) {
        action(mounted);
        return;
      }

      const index = visibleItems.findIndex((i) => i.node.item.id === id);
      if (index < 0) return;

      virtualizerRef.current?.scrollToIndex(index, { align: "auto" });
      requestAnimationFrame(() => {
        const handle = treeItemRefs.current[id];
        if (handle != null) action(handle);
      });
    },
    [visibleItems],
  );

  const treeHandle = useMemo<TreeHandle>(
    () => ({
      treeId,
      focus: tryFocus,
      hasFocus: hasFocus,
      getSelectedItems: () => getSelectedItems(store, treeId, selectableItems),
      renameItem: (id) => withTreeItem(id, (handle) => handle.rename()),
      selectItem: (id, focus) => {
        if (store.get(selectedIdsFamily(treeId)).includes(id)) {
          // Already selected
          return;
        }
        store.set(focusIdsFamily(treeId), { anchorId: id, lastId: id });
        setSelected([id], focus === true);
      },
      showContextMenu: async () => {
        if (getContextMenu == null) return;
        const items = getSelectedItems(store, treeId, selectableItems);
        const menuItems = await getContextMenu(items);
        const lastSelectedId = store.get(focusIdsFamily(treeId)).lastId;
        if (lastSelectedId == null) return;
        withTreeItem(lastSelectedId, (handle) => {
          const rect = handle.rect();
          setShowContextMenu({ items: menuItems, x: rect.x, y: rect.y });
        });
      },
    }),
    [getContextMenu, hasFocus, selectableItems, setSelected, treeId, tryFocus, withTreeItem],
  );

  useImperativeHandle(ref, (): TreeHandle => treeHandle, [treeHandle]);

  const handleGetContextMenu = useMemo(() => {
    if (getContextMenu == null) return;
    return (item: T) => {
      const items = getSelectedItems(store, treeId, selectableItems);
      const isSelected = items.find((i) => i.id === item.id);
      if (isSelected) {
        // If right-clicked an item that was in the multiple-selection, use the entire selection
        return getContextMenu(items);
      }
      // If right-clicked an item that was NOT in the multiple-selection, just use that one
      // Also update the selection with it
      setSelected([item.id], false);
      store.set(focusIdsFamily(treeId), (prev) => ({ ...prev, lastId: item.id }));
      return getContextMenu([item]);
    };
  }, [getContextMenu, selectableItems, setSelected, treeId]);

  const handleSelect = useCallback<NonNullable<TreeItemProps<T>["onClick"]>>(
    (item, { shiftKey, metaKey, ctrlKey }) => {
      const anchorSelectedId = store.get(focusIdsFamily(treeId)).anchorId;
      const selectedIdsAtom = selectedIdsFamily(treeId);
      const selectedIds = store.get(selectedIdsAtom);

      // Mark the item as the last one selected
      store.set(focusIdsFamily(treeId), (prev) => ({ ...prev, lastId: item.id }));

      if (shiftKey) {
        const anchorIndex = visibleItems.findIndex((i) => i.node.item.id === anchorSelectedId);
        const currIndex = visibleItems.findIndex((v) => v.node.item.id === item.id);

        // Nothing was selected yet, so just select this item
        if (selectedIds.length === 0 || anchorIndex === -1 || currIndex === -1) {
          setSelected([item.id], true);
          store.set(focusIdsFamily(treeId), (prev) => ({ ...prev, anchorId: item.id }));
          return;
        }

        if (currIndex > anchorIndex) {
          // Selecting down
          const itemsToSelect = visibleItems.slice(anchorIndex, currIndex + 1);
          setSelected(
            itemsToSelect.map((v) => v.node.item.id),
            true,
          );
        } else if (currIndex < anchorIndex) {
          // Selecting up
          const itemsToSelect = visibleItems.slice(currIndex, anchorIndex + 1);
          setSelected(
            itemsToSelect.map((v) => v.node.item.id),
            true,
          );
        } else {
          setSelected([item.id], true);
        }
      } else if (platform.osType() === "macos" ? metaKey : ctrlKey) {
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
        store.set(focusIdsFamily(treeId), (prev) => ({ ...prev, anchorId: item.id }));
      }
    },
    [setSelected, treeId, visibleItems],
  );

  const handleClick = useCallback<NonNullable<TreeItemProps<T>["onClick"]>>(
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
      const lastSelectedId = store.get(focusIdsFamily(treeId)).lastId;
      const index = visibleItems.findIndex((i) => i.node.item.id === lastSelectedId);
      const item = visibleItems[index - 1];
      if (item != null) {
        handleSelect(item.node.item, e);
      }
    },
    [handleSelect, treeId, visibleItems],
  );

  const selectNextItem = useCallback(
    (e: TreeItemClickEvent) => {
      const lastSelectedId = store.get(focusIdsFamily(treeId)).lastId;
      const index = visibleItems.findIndex((i) => i.node.item.id === lastSelectedId);
      const item = visibleItems[index + 1];
      if (item != null) {
        handleSelect(item.node.item, e);
      }
    },
    [handleSelect, treeId, visibleItems],
  );

  const selectParentItem = useCallback(
    (e: TreeItemClickEvent) => {
      const lastSelectedId = store.get(focusIdsFamily(treeId)).lastId;
      const lastSelectedItem =
        selectableItems.find((i) => i.node.item.id === lastSelectedId)?.node ?? null;
      if (lastSelectedItem?.parent != null) {
        handleSelect(lastSelectedItem.parent.item, e);
      }
    },
    [handleSelect, selectableItems, treeId],
  );

  useKey(
    (e) => e.key === "ArrowUp" || e.key.toLowerCase() === "k",
    (e) => {
      if (!isTreeFocused()) return;
      e.preventDefault();
      selectPrevItem(e);
    },
    undefined,
    [selectableItems, handleSelect],
  );

  useKey(
    (e) => e.key === "ArrowDown" || e.key.toLowerCase() === "j",
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
    (e) => e.key === "ArrowRight" || e.key === "l",
    (e) => {
      if (!isTreeFocused()) return;
      e.preventDefault();

      const collapsed = store.get(collapsedAtom);
      const lastSelectedId = store.get(focusIdsFamily(treeId)).lastId;
      const lastSelectedItem = selectableItems.find((i) => i.node.item.id === lastSelectedId);

      if (
        lastSelectedId &&
        lastSelectedItem?.node.children != null &&
        collapsed[lastSelectedItem.node.item.id] === true
      ) {
        store.set(collapsedAtom, { ...collapsed, [lastSelectedId]: false });
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
    (e) => e.key === "ArrowLeft" || e.key === "h",
    (e) => {
      if (!isTreeFocused()) return;
      e.preventDefault();

      const collapsed = store.get(collapsedAtom);
      const lastSelectedId = store.get(focusIdsFamily(treeId)).lastId;
      const lastSelectedItem = selectableItems.find((i) => i.node.item.id === lastSelectedId);

      if (
        lastSelectedId &&
        lastSelectedItem?.node.children != null &&
        collapsed[lastSelectedItem.node.item.id] !== true
      ) {
        store.set(collapsedAtom, { ...collapsed, [lastSelectedId]: true });
      } else {
        selectParentItem(e);
      }
    },
    { options: {} },
    [selectableItems, handleSelect],
  );

  useKeyPressEvent("Escape", async () => {
    if (!treeRef.current?.contains(document.activeElement)) return;
    clearDragState();
    const lastSelectedId = store.get(focusIdsFamily(treeId)).lastId;
    if (lastSelectedId == null) return;
    setSelected([lastSelectedId], false);
  });

  const handleDragMove = useCallback(
    function handleDragMove(e: DragMoveEvent) {
      const over = e.over;
      if (!over) {
        // Clear the drop indicator when hovering outside the tree
        store.set(hoveredParentFamily(treeId), {
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
        store.set(hoveredParentFamily(treeId), {
          parentId: root.item.id,
          parentDepth: root.depth,
          index: visibleItems.length,
          childIndex: visibleItems.length,
        });
        return;
      }

      const overSelectableItem = selectableItems.find((i) => i.node.item.id === over.id) ?? null;
      if (overSelectableItem == null) {
        return;
      }

      const draggingItems = store.get(draggingIdsFamily(treeId));
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
      const dragIndex = visibleItems.findIndex((n) => n.node.item.id === item.id) ?? -1;
      const hovered = visibleItems[dragIndex]?.node ?? null;
      const hoveredIndex = dragIndex + (side === "before" ? 0 : 1);
      let hoveredChildIndex = overSelectableItem.index + (side === "before" ? 0 : 1);

      // Move into the folder if it's open and we're moving after it
      if (hovered?.children != null && side === "after") {
        hoveredParent = hovered;
        hoveredChildIndex = 0;
      }

      const parentId = hoveredParent?.item.id ?? null;
      const parentDepth = hoveredParent?.depth ?? null;
      const index = hoveredIndex;
      const childIndex = hoveredChildIndex;
      const existing = store.get(hoveredParentFamily(treeId));
      if (
        !(
          parentId === existing.parentId &&
          parentDepth === existing.parentDepth &&
          index === existing.index &&
          childIndex === existing.childIndex
        )
      ) {
        store.set(hoveredParentFamily(treeId), {
          parentId,
          parentDepth,
          index,
          childIndex,
        });
      }
    },
    [root.depth, root.item.id, selectableItems, treeId, visibleItems],
  );

  const handleDragStart = useCallback(
    function handleDragStart(e: DragStartEvent) {
      const selectedItems = getSelectedItems(store, treeId, selectableItems);
      const isDraggingSelectedItem = selectedItems.find((i) => i.id === e.active.id);

      // If we started dragging an already-selected item, we'll use that
      if (isDraggingSelectedItem) {
        store.set(
          draggingIdsFamily(treeId),
          selectedItems.map((i) => i.id),
        );
      } else {
        // If we started dragging a non-selected item, only drag that item
        const activeItem = selectableItems.find((i) => i.node.item.id === e.active.id)?.node.item;
        if (activeItem != null) {
          store.set(draggingIdsFamily(treeId), [activeItem.id]);
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
    store.set(hoveredParentFamily(treeId), {
      parentId: null,
      parentDepth: null,
      index: null,
      childIndex: null,
    });
    store.set(draggingIdsFamily(treeId), []);
  }, [treeId]);

  const handleDragEnd = useCallback(
    function handleDragEnd(e: DragEndEvent) {
      // Get this from the store so our callback doesn't change all the time
      const {
        index: hoveredIndex,
        parentId: hoveredParentId,
        childIndex: hoveredChildIndex,
      } = store.get(hoveredParentFamily(treeId));
      const draggingItems = store.get(draggingIdsFamily(treeId));
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
    "nodes" | "treeId" | "activeIdAtom" | "hoveredParent" | "hoveredIndex"
  > = {
    getItemKey,
    getContextMenu: handleGetContextMenu,
    renderContextMenu,
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
    <CollapsedAtomContext.Provider value={collapsedAtom}>
      {showContextMenu &&
        renderContextMenu?.({
          items: showContextMenu.items,
          position: showContextMenu,
          onClose: handleCloseContextMenu,
        })}
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
          ref={setTreeRef}
          // Focusable so the container can hold focus when the focused row unmounts. Not reachable
          // by tabbing, since the rows themselves are what's tabbable.
          tabIndex={-1}
          className={classNames(
            className,
            "outline-hidden h-full",
            "overflow-y-auto overflow-x-hidden",
            "grid grid-rows-[auto_1fr]",
          )}
        >
          <div
            className={classNames(
              "[&_.tree-item.selected_.tree-item-inner]:text-text",
              "focus-within:[&_.tree-item.selected]:bg-surface-active",
              "not-focus-within:[&_.tree-item.selected:not([data-context-menu-open])]:bg-surface-highlight",
              "[&_.tree-item.selected[data-context-menu-open]]:bg-surface-active",
              // Round the items, but only if the ends of the selection.
              // Also account for the drop marker being in between items
              "[&_.tree-item]:rounded-md",
              "[&_.tree-item.selected+.tree-item.selected]:rounded-t-none",
              "[&_.tree-item.selected+.drop-marker+.tree-item.selected]:rounded-t-none",
              "[&_.tree-item.selected:has(+.tree-item.selected)]:rounded-b-none",
              "[&_.tree-item.selected:has(+.drop-marker+.tree-item.selected)]:rounded-b-none",
              // Virtualized rows are wrapped in .tree-row divs, so the sibling
              // relationships above need wrapper-aware equivalents
              "[&_.tree-row:has(.tree-item.selected)+.tree-row_.tree-item.selected]:rounded-t-none",
              "[&_.tree-row:has(.tree-item.selected):has(+.tree-row_.tree-item.selected)_.tree-item.selected]:rounded-b-none",
            )}
          >
            <TreeItemList
              addTreeItemRef={handleAddTreeItemRef}
              nodes={visibleItems}
              treeId={treeId}
              getScrollElement={getScrollElement}
              onVirtualizerReady={handleVirtualizerReady}
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
    </CollapsedAtomContext.Provider>
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
