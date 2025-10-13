import type { DragMoveEvent } from '@dnd-kit/core';
import { useDndMonitor, useDraggable, useDroppable } from '@dnd-kit/core';
import classNames from 'classnames';
import { atom, useAtomValue } from 'jotai';
import { selectAtom } from 'jotai/utils';
import type { MouseEvent, PointerEvent } from 'react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { jotaiStore } from '../../../lib/jotai';
import type { ContextMenuProps } from '../Dropdown';
import { ContextMenu } from '../Dropdown';
import { Icon } from '../Icon';
import { focusIdsFamily, isCollapsedFamily, isSelectedFamily } from './atoms';
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
  'renderItem' | 'renderLeftSlot' | 'treeId' | 'activeIdAtom' | 'getEditOptions'
> & {
  node: TreeNode<T>;
  className?: string;
  onClick?: (item: T, e: OnClickEvent) => void;
  getContextMenu?: (item: T) => ContextMenuProps['items'];
};

const emptyActiveIdAtom = atom();

export function TreeItem<T extends { id: string }>({
  treeId,
  node,
  renderItem,
  renderLeftSlot,
  activeIdAtom,
  getContextMenu,
  onClick,
  getEditOptions,
  className,
}: TreeItemProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const draggableRef = useRef<HTMLButtonElement>(null);
  const isSelected = useAtomValue(isSelectedFamily({ treeId, itemId: node.item.id }));
  const isCollapsed = useAtomValue(isCollapsedFamily({ treeId, itemId: node.item.id }));
  const lastSelectedId = useAtomValue(focusIdsFamily(treeId)).lastId;
  const [editing, setEditing] = useState<boolean>(false);
  const [isDropHover, setIsDropHover] = useState<boolean>(false);

  const isActiveAtom = useMemo(() => {
    const source = activeIdAtom ?? emptyActiveIdAtom;
    // notify only when the boolean changes
    return selectAtom(source, (activeId) => activeId === node.item.id, Object.is);
  }, [activeIdAtom, node.item.id]);

  const isActive = useAtomValue(isActiveAtom);
  useEffect(() => {
    if (lastSelectedId === node.item.id) {
      draggableRef.current?.focus();
    }
  }, [lastSelectedId, node.item.id]);

  // Scroll into view when it becomes selected
  useEffect(() => {
    if (isSelected) {
      ref.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [isSelected]);

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
      setTimeout(() => setEditing(false));
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

  const handleEditKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    switch (e.key) {
      case 'Enter':
        break;
      case 'Escape':
        e.preventDefault();
        setEditing(false);
        break;
    }
  }, []);

  const handleDoubleClick = useCallback(() => {
    const isFolder = node.children != null;
    if (isFolder) {
      toggleCollapsed();
    } else if (getEditOptions) {
      setEditing(true);
    }
  }, [getEditOptions, node.children, toggleCollapsed]);

  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
  } = useDraggable({
    id: node.item.id,
    attributes: {
      tabIndex: lastSelectedId ? 0 : -1,
    },
  });

  const { setNodeRef: setDroppableRef } = useDroppable({
    id: node.item.id,
  });

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
        }, 800);
      } else {
        clearHoverTimer();
      }
    },
  });

  const [showContextMenu, setShowContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const startedHoverTimeout = useRef<NodeJS.Timeout>(undefined);
  const handleContextMenu = useCallback((e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setShowContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handlePointerDown = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
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

  const handleCloseContextMenu = useCallback(() => {
    setShowContextMenu(null);
  }, []);

  return (
    <div
      ref={ref}
      onContextMenu={handleContextMenu}
      className={classNames(
        className,
        'h-sm grid grid-cols-[auto_minmax(0,1fr)] items-center rounded px-2',
        editing && 'ring-1 focus-within:ring-focus',
        isSelected && 'bg-surface-highlight',
        isDropHover && 'relative z-10 ring-2 ring-primary animate-blinkRing',
      )}
    >
      {showContextMenu && getContextMenu && (
        <ContextMenu
          items={getContextMenu(node.item)}
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
        className={classNames(
          'flex items-center gap-2 h-full whitespace-nowrap',
          isActive || isDropHover ? 'text-text' : 'text-text-subtle',
        )}
        {...listeners}
        {...attributes}
        tabIndex={lastSelectedId == node.item.id ? 0 : -1}
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
