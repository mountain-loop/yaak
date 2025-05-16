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
import { useKey, useKeyPressEvent } from 'react-use';
import { activeRequestIdAtom } from '../../hooks/useActiveRequestId';
import { activeWorkspaceAtom } from '../../hooks/useActiveWorkspace';
import { useCreateDropdownItems } from '../../hooks/useCreateDropdownItems';
import { useHotKey } from '../../hooks/useHotKey';
import { useSidebarHidden } from '../../hooks/useSidebarHidden';
import { getSidebarCollapsedMap } from '../../hooks/useSidebarItemCollapsed';
import { deleteModelWithConfirm } from '../../lib/deleteModelWithConfirm';
import { jotaiStore } from '../../lib/jotai';
import { router } from '../../lib/router';
import { setWorkspaceSearchParams } from '../../lib/setWorkspaceSearchParams';
import { ContextMenu } from '../core/Dropdown';
import { GitDropdown } from '../GitDropdown';
import { sidebarSelectedIdAtom, sidebarTreeAtom } from './SidebarAtoms';
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
  const [hasFocus, setHasFocus] = useState<boolean>(false);
  const [selectedId, setSelectedId] = useAtom(sidebarSelectedIdAtom);
  const [selectedTree, setSelectedTree] = useState<SidebarTreeNode | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoveredTree, setHoveredTree] = useState<SidebarTreeNode | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const { tree, treeParentMap, selectableRequests } = useAtomValue(sidebarTreeAtom);

  const focusActiveRequest = useCallback(
    (
      args: {
        forced?: {
          id: string;
          tree: SidebarTreeNode;
        };
        noFocusSidebar?: boolean;
      } = {},
    ) => {
      const activeRequestId = jotaiStore.get(activeRequestIdAtom);
      const { forced, noFocusSidebar } = args;
      const tree = forced?.tree ?? treeParentMap[activeRequestId ?? 'n/a'] ?? null;
      const children = tree?.children ?? [];
      const id = forced?.id ?? children.find((m) => m.id === activeRequestId)?.id ?? null;

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
      if (node.model !== 'folder' && node.workspaceId) {
        const workspaceId = node.workspaceId;
        await router.navigate({
          to: '/workspaces/$workspaceId',
          params: { workspaceId },
          search: (prev) => ({ ...prev, request_id: node.id }),
        });

        setHasFocus(true);
        setSelectedId(id);
        setSelectedTree(tree);
      }
    },
    [treeParentMap, setSelectedId],
  );

  const handleClearSelected = useCallback(() => {
    setSelectedId(null);
    setSelectedTree(null);
  }, [setSelectedId]);

  const handleFocus = useCallback(() => {
    if (hasFocus) return;
    focusActiveRequest({ noFocusSidebar: true });
  }, [focusActiveRequest, hasFocus]);

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

    // Select 0th index on focus if none selected
    focusActiveRequest(
      selectedTree != null && selectedId != null
        ? { forced: { id: selectedId, tree: selectedTree } }
        : undefined,
    );
  });

  useKeyPressEvent('Enter', async (e) => {
    if (!hasFocus) return;
    const selected = selectableRequests.find((r) => r.id === selectedId);
    if (!selected || activeWorkspace == null) {
      return;
    }

    e.preventDefault();
    setWorkspaceSearchParams({ request_id: selected.id });
  });

  useKey(
    'ArrowUp',
    (e) => {
      if (!hasFocus) return;
      e.preventDefault();
      const i = selectableRequests.findIndex((r) => r.id === selectedId);
      const newI = i <= 0 ? selectableRequests.length - 1 : i - 1;
      const newSelectable = selectableRequests[newI];
      if (newSelectable == null) {
        return;
      }

      setSelectedId(newSelectable.id);
      setSelectedTree(newSelectable.tree);
    },
    undefined,
    [hasFocus, selectableRequests, selectedId, setSelectedId, setSelectedTree],
  );

  useKey(
    'ArrowDown',
    (e) => {
      if (!hasFocus) return;
      e.preventDefault();
      const i = selectableRequests.findIndex((r) => r.id === selectedId);
      const newI = i >= selectableRequests.length - 1 ? 0 : i + 1;
      const newSelectable = selectableRequests[newI];
      if (newSelectable == null) {
        return;
      }

      setSelectedId(newSelectable.id);
      setSelectedTree(newSelectable.tree);
    },
    undefined,
    [hasFocus, selectableRequests, selectedId, setSelectedId, setSelectedTree],
  );

  const handleMove = useCallback<SidebarItemProps['onMove']>(
    async (id, side) => {
      let hoveredTree = treeParentMap[id] ?? null;
      const dragIndex = hoveredTree?.children.findIndex((n) => n.id === id) ?? -99;
      const hoveredItem = hoveredTree?.children[dragIndex] ?? null;
      let hoveredIndex = dragIndex + (side === 'above' ? 0 : 1);

      const isHoveredItemCollapsed =
        hoveredItem != null ? getSidebarCollapsedMap()[hoveredItem.id] : false;
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
        return patchModelById(child.model, child.id, { sortPriority, folderId });
      }
      setDraggingId(null);
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

  // Not ready to render yet
  if (tree == null) {
    return null;
  }

  return (
    <aside
      aria-hidden={hidden ?? undefined}
      ref={sidebarRef}
      onFocus={handleFocus}
      onBlur={handleBlur}
      tabIndex={hidden ? -1 : 0}
      onContextMenu={handleMainContextMenu}
      data-focused={hasFocus}
      className={classNames(
        className,
        // Style item selection color here, because it's very hard to do in an efficient
        // way in the item itself (selection ID makes it hard)
        hasFocus && '[&_[data-selected=true]]:bg-surface-active',
        'h-full grid grid-rows-[minmax(0,1fr)_auto]',
      )}
    >
      <div className="pb-3 overflow-x-visible overflow-y-scroll pt-2">
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
