import type { DragMoveEvent } from '@dnd-kit/core';
import { useDndMonitor, useDraggable, useDroppable } from '@dnd-kit/core';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import type { MouseEvent, PointerEvent } from 'react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { jotaiStore } from '../../../lib/jotai';
import type { ContextMenuProps, DropdownItem } from '../Dropdown';
import { ContextMenu } from '../Dropdown';
import { Icon } from '../Icon';
import {
  focusIdsFamily,
  isCollapsedFamily,
  isLastFocusedFamily,
  isParentHoveredFamily,
  isSelectedFamily,
  selectedIdsFamily,
} from './atoms';
import type { TreeNode } from './common';
import { computeSideForDragMove } from './common';
import type { TreeProps } from './Tree';

interface OnClickEvent {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export type TreeItemProps<T extends { id: string }> = Pick<
  TreeProps<T>,
  'renderItem' | 'renderLeftSlot' | 'treeId' | 'getEditOptions'
> & {
  node: TreeNode<T>;
  className?: string;
  onClick?: (item: T, e: OnClickEvent) => void;
  getContextMenu?: (item: T) => ContextMenuProps['items'];
};

const HOVER_CLOSED_FOLDER_DELAY = 800;

export function TreeItem<T extends { id: string }>({
  treeId,
  node,
  renderItem,
  renderLeftSlot,
  getContextMenu,
  onClick,
  getEditOptions,
  className,
}: TreeItemProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const draggableRef = useRef<HTMLButtonElement>(null);
  // const treeFocused = useAtomValue(treeFocusedAtom);
  const isSelected = useAtomValue(isSelectedFamily({ treeId, itemId: node.item.id }));
  const isCollapsed = useAtomValue(isCollapsedFamily({ treeId, itemId: node.item.id }));
  const isHoveredAsParent = useAtomValue(isParentHoveredFamily({ treeId, parentId: node.item.id }));
  const isLastSelected = useAtomValue(isLastFocusedFamily({ treeId, itemId: node.item.id }));
  const [editing, setEditing] = useState<boolean>(false);
  const [isDropHover, setIsDropHover] = useState<boolean>(false);

  const [showContextMenu, setShowContextMenu] = useState<{
    items: DropdownItem[];
    x: number;
    y: number;
  } | null>(null);

  useEffect(
    function focusWhenSelectionChanges() {
      return jotaiStore.sub(focusIdsFamily(treeId), () => {
        const lastSelectedId = jotaiStore.get(focusIdsFamily(treeId)).lastId;
        if (showContextMenu == null) return;
        if (lastSelectedId === node.item.id) {
          // draggableRef.current?.focus();
        }
      });
    },
    [node.item.id, showContextMenu, treeId],
  );

  useEffect(
    function scrollIntoViewWhenSelected() {
      return jotaiStore.sub(isSelectedFamily({ treeId, itemId: node.item.id }), () => {
        ref.current?.scrollIntoView({ block: 'nearest' });
      });
    },
    [node.item.id, treeId],
  );

  const handleClick = useCallback(
    function handleClick(e: OnClickEvent) {
      onClick?.(node.item, e);
    },
    [node, onClick],
  );

  const toggleCollapsed = useCallback(
    function toggleCollapsed() {
      jotaiStore.set(isCollapsedFamily({ treeId, itemId: node.item.id }), (prev) => !prev);
    },
    [node.item.id, treeId],
  );

  const handleSubmitNameEdit = useCallback(
    async function submitNameEdit(el: HTMLInputElement) {
      getEditOptions?.(node.item).onChange(node.item, el.value);
      // Slight delay for the model to propagate to the local store
      setTimeout(() => setEditing(false), 200);
    },
    [getEditOptions, node.item],
  );

  const handleEditFocus = useCallback(function handleEditFocus(el: HTMLInputElement | null) {
    el?.focus();
    el?.select();
  }, []);

  const handleEditBlur = useCallback(
    async function editBlur(e: React.FocusEvent<HTMLInputElement>) {
      await handleSubmitNameEdit(e.currentTarget);
    },
    [handleSubmitNameEdit],
  );

  const handleEditKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLInputElement>) => {
      e.stopPropagation();
      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          await handleSubmitNameEdit(e.currentTarget);
          break;
        case 'Escape':
          e.preventDefault();
          setEditing(false);
          break;
      }
    },
    [handleSubmitNameEdit],
  );

  const handleDoubleClick = useCallback(() => {
    const isFolder = node.children != null;
    if (isFolder) {
      toggleCollapsed();
    } else if (getEditOptions) {
      setEditing(true);
    }
  }, [getEditOptions, node.children, toggleCollapsed]);

  const clearHoverTimer = () => {
    if (startedHoverTimeout.current) {
      setIsDropHover(false); // NEW
      clearTimeout(startedHoverTimeout.current); // NEW
      startedHoverTimeout.current = undefined; // NEW
    }
  };

  // Toggle auto-expand of folders when hovering over them
  useDndMonitor({
    onDragMove(e: DragMoveEvent) {
      const side = computeSideForDragMove(node, e);
      const isFolderWithChildren = (node.children?.length ?? 0) > 0;
      const isCollapsed = jotaiStore.get(isCollapsedFamily({ treeId, itemId: node.item.id }));
      if (isCollapsed && isFolderWithChildren && side === 'below') {
        setIsDropHover(true);
        clearTimeout(startedHoverTimeout.current);
        startedHoverTimeout.current = setTimeout(() => {
          jotaiStore.set(isCollapsedFamily({ treeId, itemId: node.item.id }), false);
          setIsDropHover(false);
        }, HOVER_CLOSED_FOLDER_DELAY);
      } else {
        clearHoverTimer();
      }
    },
  });

  const startedHoverTimeout = useRef<NodeJS.Timeout>(undefined);
  const handleContextMenu = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (getContextMenu == null) return;

      e.preventDefault();
      e.stopPropagation();
      const items = getContextMenu(node.item);
      const isSelected = jotaiStore.get(isSelectedFamily({ treeId, itemId: node.item.id }));
      console.log(
        'HANDLE CONTEXT MENU',
        isSelected,
        node.item.id,
        jotaiStore.get(selectedIdsFamily(treeId)),
      );
      if (!isSelected) {
        // handleClick(e);
      }
      setShowContextMenu({ items, x: e.clientX, y: e.clientY });
    },
    [getContextMenu, node.item, treeId],
  );

  const handleCloseContextMenu = useCallback(() => {
    setShowContextMenu(null);
  }, []);

  const { attributes, listeners, setNodeRef: setDraggableRef } = useDraggable({ id: node.item.id });

  const { setNodeRef: setDroppableRef } = useDroppable({
    id: node.item.id,
  });

  const handlePointerDown = useCallback(
    function handlePointerDown(e: PointerEvent<HTMLButtonElement>) {
      console.log('HANDLE POINTER DOWN', e);
      const handleByTree = e.metaKey || e.ctrlKey || e.shiftKey;
      if (!handleByTree) {
        listeners?.onPointerDown?.(e);
      }
    },
    [listeners],
  );

  const handleSetDraggableRef = useCallback(
    (node: HTMLButtonElement | null) => {
      draggableRef.current = node;
      setDraggableRef(node);
      setDroppableRef(node);
    },
    [setDraggableRef, setDroppableRef],
  );

  return (
    <div
      ref={ref}
      onContextMenu={handleContextMenu}
      className={classNames(
        className,
        'tree-item',
        isSelected && 'selected',
        'text-text-subtle',
        'focus-within:ring-1 focus-within:ring-border-focus',
        'h-sm grid grid-cols-[auto_minmax(0,1fr)] items-center rounded px-2',
        editing && 'ring-1 focus-within:ring-focus',
        isDropHover && 'relative z-10 ring-2 ring-primary animate-blinkRing',
      )}
    >
      {showContextMenu && (
        <ContextMenu
          items={showContextMenu.items}
          triggerPosition={showContextMenu}
          onClose={handleCloseContextMenu}
        />
      )}
      {node.children != null ? (
        <button
          tabIndex={-1}
          className="h-full w-[2.8rem] pr-[0.5rem] -ml-[1rem]"
          onClick={toggleCollapsed}
        >
          <Icon
            icon="chevron_right"
            className={classNames(
              'transition-transform text-text-subtlest',
              'ml-auto !h-[1rem] !w-[1rem]',
              node.children.length == 0 && 'opacity-0',
              !isCollapsed && 'rotate-90',
              isHoveredAsParent && '!text-text',
            )}
          />
        </button>
      ) : (
        <span />
      )}
      <button
        ref={handleSetDraggableRef}
        onPointerDown={handlePointerDown}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        disabled={editing}
        className="focus:outline-none flex items-center gap-2 h-full whitespace-nowrap"
        {...attributes}
        {...listeners}
        tabIndex={isLastSelected ? 0 : -1}
      >
        {renderLeftSlot?.(node.item)}
        {getEditOptions && editing
          ? (() => {
              const { defaultValue, placeholder } = getEditOptions(node.item);
              return (
                <input
                  ref={handleEditFocus}
                  defaultValue={defaultValue}
                  placeholder={placeholder}
                  className="bg-transparent outline-none w-full cursor-text"
                  onBlur={handleEditBlur}
                  onKeyDown={handleEditKeyDown}
                />
              );
            })()
          : renderItem(node.item)}
      </button>
    </div>
  );
}
