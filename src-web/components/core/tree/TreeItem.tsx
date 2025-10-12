import classNames from 'classnames';
import { atom, useAtomValue } from 'jotai';
import { selectAtom } from 'jotai/utils';
import React, { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDrag, useDrop, type XYCoord } from 'react-dnd';
import { jotaiStore } from '../../../lib/jotai';
import type { ContextMenuProps } from '../Dropdown';
import { ContextMenu } from '../Dropdown';
import { Icon } from '../Icon';
import { draggingIdsFamily, isCollapsedFamily, isSelectedFamily } from './atoms';
import type { TreeNode } from './common';
import type { DragItem } from './dnd';
import { ItemTypes } from './dnd';
import type { TreeProps } from './Tree';

export type TreeItemProps<T extends { id: string }> = Pick<
  TreeProps<T>,
  'renderItem' | 'renderLeftSlot' | 'treeId' | 'activeIdAtom' | 'getEditOptions'
> & {
  node: TreeNode<T>;
  className?: string;
  onMove?: (item: T, side: 'above' | 'below') => void;
  onEnd?: () => void;
  onDragStart?: (item: T) => void;
  onClick?: (item: T, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => void;
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
  onMove,
  onDragStart,
  onEnd,
  onClick,
  getEditOptions,
  className,
}: TreeItemProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const isSelected = useAtomValue(isSelectedFamily({ treeId, itemId: node.item.id }));
  const isCollapsed = useAtomValue(isCollapsedFamily({ treeId, itemId: node.item.id }));
  const [editing, setEditing] = useState<boolean>(false);

  const isActiveAtom = useMemo(() => {
    const source = activeIdAtom ?? emptyActiveIdAtom;
    // notify only when the boolean changes
    return selectAtom(source, (activeId) => activeId === node.item.id, Object.is);
  }, [activeIdAtom, node.item.id]);

  const isActive = useAtomValue(isActiveAtom);

  // Scroll into view when it becomes selected
  useEffect(() => {
    if (isSelected) {
      ref.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [isSelected]);

  const handleClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      onClick?.(node.item, e);
    },
    [node, onClick],
  );

  const toggleCollapsed = useCallback(() => {
    jotaiStore.set(isCollapsedFamily({ treeId, itemId: node.item.id }), (prev) => !prev);
  }, [node.item.id, treeId]);

  const handleSubmitNameEdit = useCallback(
    async (el: HTMLInputElement) => {
      getEditOptions?.(node.item).onChange(node.item, el.value);
      // Slight delay for the model to propagate to the local store
      setTimeout(() => setEditing(false));
    },
    [getEditOptions, node.item],
  );

  const handleEditFocus = useCallback((el: HTMLInputElement | null) => {
    el?.focus();
    el?.select();
  }, []);

  const handleEditBlur = useCallback(
    async (e: React.FocusEvent<HTMLInputElement>) => {
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

  const [, connectDrag] = useDrag<
    DragItem,
    unknown,
    {
      isDragging: boolean;
    }
  >(
    () => ({
      type: ItemTypes.TREE_ITEM,
      item: () => {
        if (editing) return null; // Cancel drag when editing
        onDragStart?.(node.item);
        return { id: node.item.id };
      },
      collect: (m) => ({ isDragging: m.isDragging() }),
      options: { dropEffect: 'move' },
      end: () => onEnd?.(),
    }),
    [onEnd],
  );

  const [, connectDrop] = useDrop<DragItem, void>(
    {
      accept: [ItemTypes.TREE, ItemTypes.TREE_ITEM],
      hover: (_, monitor) => {
        if (!ref.current) return;
        if (!monitor.isOver()) return;
        const hoverBoundingRect = ref.current?.getBoundingClientRect();
        const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
        const clientOffset = monitor.getClientOffset();
        const hoverClientY = (clientOffset as XYCoord).y - hoverBoundingRect.top;
        onMove?.(node.item, hoverClientY < hoverMiddleY ? 'above' : 'below');
      },
    },
    [onMove],
  );

  connectDrag(connectDrop(ref));

  const [showContextMenu, setShowContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const startedHoverTimeout = useRef<NodeJS.Timeout>(undefined);
  const [isDropHover, setIsDropHover] = useState<boolean>(false);
  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setShowContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsDropHover(false);
    clearTimeout(startedHoverTimeout.current);
  }, []);

  const handleMouseEnter = useCallback(
    () => {
      const isDraggingSomething = jotaiStore.get(draggingIdsFamily(treeId)).length > 0;
      const isFolderWithChildren = (node.children?.length ?? 0) > 0;
      if (!isFolderWithChildren || !isCollapsed || !isDraggingSomething) return;

      setIsDropHover(true);
      startedHoverTimeout.current = setTimeout(() => {
        toggleCollapsed();
        setIsDropHover(false);
      }, 1000);
    },
    [isCollapsed, node.children?.length, toggleCollapsed, treeId],
  );

  return (
    <div
      ref={ref}
      onContextMenu={handleContextMenu}
      onMouseLeave={handleMouseLeave}
      onMouseEnter={handleMouseEnter}
      className={classNames(
        className,
        'h-sm grid grid-cols-[auto_minmax(0,1fr)] items-center rounded px-2',
        editing && 'ring-1 focus-within:ring-focus',
        isSelected && 'bg-surface-highlight',
        isDropHover && 'ring-2 ring-primary animate-blinkRing',
      )}
    >
      {showContextMenu && getContextMenu && (
        <ContextMenu
          items={getContextMenu(node.item)}
          triggerPosition={showContextMenu}
          onClose={() => setShowContextMenu(null)}
        />
      )}
      {node.children != null ? (
        <button className="h-full w-[2.8rem] pr-[0.5rem] -ml-[1rem]" onClick={toggleCollapsed}>
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
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        disabled={editing}
        className={classNames(
          'flex items-center gap-2 h-full whitespace-nowrap',
          isActive ? 'text-text' : 'text-text-subtle',
        )}
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
