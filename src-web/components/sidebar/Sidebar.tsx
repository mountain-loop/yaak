import type {
  Folder,
  GrpcRequest,
  HttpRequest,
  WebsocketRequest,
  Workspace,
} from '@yaakapp-internal/models';
import { getAnyModel, patchModelById } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { useAtom, useAtomValue } from 'jotai';
import React, { useCallback, useRef, useState } from 'react';
import { useDrop } from 'react-dnd';
import { useKey, useKeyPressEvent } from 'react-use';
import { activeWorkspaceAtom } from '../../hooks/useActiveWorkspace';
import { useCreateDropdownItems } from '../../hooks/useCreateDropdownItems';
import { useHotKey } from '../../hooks/useHotKey';
import { useSidebarHidden } from '../../hooks/useSidebarHidden';
import {
  sidebarCollapsedAtom,
  toggleSidebarItemCollapsed,
} from '../../hooks/useSidebarItemCollapsed';
import { deleteModelWithConfirm } from '../../lib/deleteModelWithConfirm';
import { jotaiStore } from '../../lib/jotai';
import {
  navigateToRequestOrFolderOrWorkspace,
  setWorkspaceSearchParams,
} from '../../lib/setWorkspaceSearchParams';
import { ContextMenu } from '../core/Dropdown';
import { GitDropdown } from '../GitDropdown';
import type { DragItem } from './dnd';
import { ItemTypes } from './dnd';
import {
  sidebarActiveItemAtom,
  sidebarHasFocusAtom,
  sidebarSelectedIdAtom,
  sidebarTreeAtom,
} from './SidebarAtoms';
import type { SidebarItemProps } from './SidebarItem';
import { SidebarItems } from './SidebarItems';

interface Props {
  className?: string;
}

export type SidebarModel = Folder | GrpcRequest | HttpRequest | WebsocketRequest | Workspace;

export interface SidebarTreeNode {
  id: string;
  name: string;
  model: SidebarModel['model'];
  sortPriority?: number;
  workspaceId?: string;
  folderId?: string | null;
  children: SidebarTreeNode[];
  depth: number;
}

export function Sidebar({ className }: Props) {
  const [hidden, setHidden] = useSidebarHidden();
  const sidebarRef = useRef<HTMLElement>(null);
  const activeWorkspace = useAtomValue(activeWorkspaceAtom);
  const [hasFocus, setHasFocus] = useAtom(sidebarHasFocusAtom);
  const [selectedId, setSelectedId] = useAtom(sidebarSelectedIdAtom);
  const [selectedTree, setSelectedTree] = useState<SidebarTreeNode | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoveredTree, setHoveredTree] = useState<SidebarTreeNode | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const { tree, treeParentMap, selectableItems } = useAtomValue(sidebarTreeAtom);

  const focusActiveItem = useCallback(
    (
      args: {
        forced?: {
          id: string;
          tree: SidebarTreeNode;
        };
        noFocusSidebar?: boolean;
      } = {},
    ) => {
      const activeItemId = jotaiStore.get(sidebarActiveItemAtom)?.id;
      const { forced, noFocusSidebar } = args;
      const tree = forced?.tree ?? treeParentMap[activeItemId ?? 'n/a'] ?? null;
      const children = tree?.children ?? [];
      const id = forced?.id ?? children.find((m) => m.id === activeItemId)?.id ?? null;

      setHasFocus(true);
      setSelectedId(id);
      setSelectedTree(tree);

      if (id == null) {
        return;
      }
      if (!noFocusSidebar) {
        sidebarRef.current?.focus();
      }
    },
    [setHasFocus, setSelectedId, treeParentMap],
  );

  const handleSelect = useCallback(
    async (id: string) => {
      const tree = treeParentMap[id ?? 'n/a'] ?? null;
      const children = tree?.children ?? [];
      const node = children.find((m) => m.id === id) ?? null;
      if (node == null || tree == null || node.model === 'workspace') {
        return;
      }

      // NOTE: I'm not sure why, but TS thinks workspaceId is (string | undefined) here
      if (node.workspaceId) {
        navigateToRequestOrFolderOrWorkspace(node.id, node.model);
      }

      setHasFocus(true);
      setSelectedId(id);
      setSelectedTree(tree);
    },
    [treeParentMap, setHasFocus, setSelectedId],
  );

  const handleClearSelected = useCallback(() => {
    setSelectedId(null);
    setSelectedTree(null);
  }, [setSelectedId]);

  const handleBlur = useCallback(() => setHasFocus(false), [setHasFocus]);

  useHotKey(
    'sidebar.delete_selected_item',
    async () => {
      const request = getAnyModel(selectedId ?? 'n/a');
      if (request != null) {
        await deleteModelWithConfirm(request);
      }
    },
    { enable: hasFocus },
  );

  useHotKey('sidebar.focus', async () => {
    // Hide the sidebar if it's already focused
    if (!hidden && hasFocus) {
      await setHidden(true);
      return;
    }

    // Show the sidebar if it's hidden
    if (hidden) {
      await setHidden(false);
    }

    // Select the 0th index on focus if none selected
    focusActiveItem(
      selectedTree != null && selectedId != null
        ? { forced: { id: selectedId, tree: selectedTree } }
        : undefined,
    );
  });

  useKeyPressEvent('Enter', async (e) => {
    if (!hasFocus) {
      return;
    }
    const selected = selectableItems.find((r) => r.id === selectedId);
    if (!selected || activeWorkspace == null) {
      return;
    }
    e.preventDefault();
    if (selected.model === 'folder') {
      toggleSidebarItemCollapsed(selected.id);
    } else {
      setWorkspaceSearchParams({ request_id: selected.id, folder_id: null });
    }
  });

  useKey(
    'ArrowUp',
    (e) => {
      if (!hasFocus) return;
      e.preventDefault();
      const i = selectableItems.findIndex((r) => r.id === selectedId);
      const newI = i <= 0 ? selectableItems.length - 1 : i - 1;
      const newSelectable = selectableItems[newI];
      if (newSelectable == null) {
        return;
      }

      setSelectedId(newSelectable.id);
      setSelectedTree(newSelectable.tree);
      if (e.shiftKey) {
        navigateToRequestOrFolderOrWorkspace(newSelectable.id, newSelectable.model);
      }
    },
    undefined,
    [hasFocus, selectableItems, selectedId, setSelectedId, setSelectedTree],
  );

  useKey(
    'ArrowDown',
    (e) => {
      if (!hasFocus) return;
      e.preventDefault();
      const i = selectableItems.findIndex((r) => r.id === selectedId);
      const newI = i >= selectableItems.length - 1 ? 0 : i + 1;
      const newSelectable = selectableItems[newI];
      if (newSelectable == null) {
        return;
      }

      setSelectedId(newSelectable.id);
      setSelectedTree(newSelectable.tree);
      if (e.shiftKey) {
        navigateToRequestOrFolderOrWorkspace(newSelectable.id, newSelectable.model);
      }
    },
    undefined,
    [hasFocus, selectableItems, selectedId, setSelectedId, setSelectedTree],
  );

  const handleMoveToSidebarEnd = useCallback(() => {
    setHoveredTree(tree);
    // Put at the end of the top tree
    setHoveredIndex(tree?.children?.length ?? 0);
  }, [tree]);

  const handleMove = useCallback<SidebarItemProps['onMove']>(
    (id, side) => {
      let hoveredTree = treeParentMap[id] ?? null;
      const dragIndex = hoveredTree?.children.findIndex((n) => n.id === id) ?? -99;
      const hoveredItem = hoveredTree?.children[dragIndex] ?? null;
      let hoveredIndex = dragIndex + (side === 'above' ? 0 : 1);

      const collapsedMap = jotaiStore.get(jotaiStore.get(sidebarCollapsedAtom));
      const isHoveredItemCollapsed = hoveredItem != null ? collapsedMap[hoveredItem.id] : false;

      if (hoveredItem?.model === 'folder' && side === 'below' && !isHoveredItemCollapsed) {
        // Move into the folder if it's open and we're moving below it
        hoveredTree = hoveredTree?.children.find((n) => n.id === id) ?? null;
        hoveredIndex = 0;
      }

      setHoveredTree(hoveredTree);
      setHoveredIndex(hoveredIndex);
    },
    [treeParentMap],
  );

  const handleDragStart = useCallback<SidebarItemProps['onDragStart']>((id: string) => {
    setDraggingId(id);
  }, []);

  const handleEnd = useCallback<SidebarItemProps['onEnd']>(
    async (itemId) => {
      setHoveredTree(null);
      setDraggingId(null);
      handleClearSelected();

      if (hoveredTree == null || hoveredIndex == null) {
        return;
      }

      // Block dragging folder into itself
      if (hoveredTree.id === itemId) {
        return;
      }

      const parentTree = treeParentMap[itemId] ?? null;
      const index = parentTree?.children.findIndex((n) => n.id === itemId) ?? -1;
      const child = parentTree?.children[index ?? -1];
      if (child == null || parentTree == null) return;

      const movedToDifferentTree = hoveredTree.id !== parentTree.id;
      const movedUpInSameTree = !movedToDifferentTree && hoveredIndex < index;

      const newChildren = hoveredTree.children.filter((c) => c.id !== itemId);
      if (movedToDifferentTree || movedUpInSameTree) {
        // Moving up or into a new tree is simply inserting before the hovered item
        newChildren.splice(hoveredIndex, 0, child);
      } else {
        // Moving down has to account for the fact that the original item will be removed
        newChildren.splice(hoveredIndex - 1, 0, child);
      }

      const insertedIndex = newChildren.findIndex((c) => c.id === child.id);
      const prev = newChildren[insertedIndex - 1];
      const next = newChildren[insertedIndex + 1];
      const beforePriority = prev?.sortPriority ?? 0;
      const afterPriority = next?.sortPriority ?? 0;

      const folderId = hoveredTree.model === 'folder' ? hoveredTree.id : null;
      const shouldUpdateAll = afterPriority - beforePriority < 1;

      if (shouldUpdateAll) {
        await Promise.all(
          newChildren.map((child, i) => {
            const sortPriority = i * 1000;
            return patchModelById(child.model, child.id, { sortPriority, folderId });
          }),
        );
      } else {
        const sortPriority = afterPriority - (afterPriority - beforePriority) / 2;
        await patchModelById(child.model, child.id, { sortPriority, folderId });
      }
    },
    [handleClearSelected, hoveredTree, hoveredIndex, treeParentMap],
  );

  const [showMainContextMenu, setShowMainContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const handleMainContextMenu = useCallback((e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setShowMainContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const mainContextMenuItems = useCreateDropdownItems({ folderId: null });

  const [, connectDrop] = useDrop<DragItem, void>(
    {
      accept: ItemTypes.REQUEST,
      hover: (_, monitor) => {
        if (sidebarRef.current == null) return;
        if (!monitor.isOver({ shallow: true })) return;
        handleMoveToSidebarEnd();
      },
    },
    [handleMoveToSidebarEnd],
  );

  connectDrop(sidebarRef);

  // Not ready to render yet
  if (tree == null) {
    return null;
  }

  return (
    <aside
      aria-hidden={hidden ?? undefined}
      ref={sidebarRef}
      onBlur={handleBlur}
      tabIndex={hidden ? -1 : 0}
      onContextMenu={handleMainContextMenu}
      data-focused={hasFocus}
      className={classNames(
        className,
        // Style item selection color here, because it's very hard to do
        // efficiently in the item itself (selection ID makes it hard)
        hasFocus && '[&_[data-selected=true]]:ring-1 [&_[data-selected=true]]:ring-border-focus',
        'h-full grid grid-rows-[minmax(0,1fr)_auto]',
      )}
    >
      <div className="pb-3 overflow-x-visible overflow-y-scroll pt-2 pr-0.5">
        <ContextMenu
          triggerPosition={showMainContextMenu}
          items={mainContextMenuItems}
          onClose={() => setShowMainContextMenu(null)}
        />
        <SidebarItems
          treeParentMap={treeParentMap}
          selectedTree={selectedTree}
          tree={tree}
          draggingId={draggingId}
          onSelect={handleSelect}
          hoveredIndex={hoveredIndex}
          hoveredTree={hoveredTree}
          handleMove={handleMove}
          handleEnd={handleEnd}
          handleDragStart={handleDragStart}
        />
      </div>
      <GitDropdown />
    </aside>
  );
}
