import type { DragMoveEvent } from '@dnd-kit/core';
import { useDndMonitor, useDraggable, useDroppable } from '@dnd-kit/core';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { selectAtom } from 'jotai/utils';
import type { MouseEvent, PointerEvent, ReactElement, RefAttributes } from 'react';
import React, { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeSideForDragMove } from '../../../lib/dnd';
import { jotaiStore } from '../../../lib/jotai';
import type { ContextMenuProps, DropdownItem } from '../Dropdown';
import { ContextMenu } from '../Dropdown';
import { Icon } from '../Icon';
import { collapsedFamily, isCollapsedFamily, isLastFocusedFamily, isSelectedFamily } from './atoms';
import type { TreeNode } from './common';
import type { TreeProps } from './Tree';
import { TreeIndentGuide } from './TreeIndentGuide';

interface OnClickEvent {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export type TreeItemProps<T extends { id: string }> = Pick<
  TreeProps<T>,
  'ItemInner' | 'ItemLeftSlot' | 'treeId' | 'getEditOptions' | 'getItemKey'
> & {
  node: TreeNode<T>;
  className?: string;
  onClick?: (item: T, e: OnClickEvent) => void;
  getContextMenu?: (item: T) => Promise<ContextMenuProps['items']>;
  depth: number;
  addRef?: (item: T, n: TreeItemHandle | null) => void;
};

export interface TreeItemHandle {
  rename: () => void;
  isRenaming: boolean;
}

const HOVER_CLOSED_FOLDER_DELAY = 800;

function TreeItemInner<T extends { id: string }>({
  treeId,
  node,
  ItemInner,
  ItemLeftSlot,
  getContextMenu,
  onClick,
  getEditOptions,
  className,
  depth,
  addRef,
}: TreeItemProps<T>) {
  const listItemRef = useRef<HTMLLIElement>(null);
  const draggableRef = useRef<HTMLButtonElement>(null);
  const isSelected = useAtomValue(isSelectedFamily({ treeId, itemId: node.item.id }));
  const isCollapsed = useAtomValue(isCollapsedFamily({ treeId, itemId: node.item.id }));
  const isLastSelected = useAtomValue(isLastFocusedFamily({ treeId, itemId: node.item.id }));
  const [editing, setEditing] = useState<boolean>(false);
  const [dropHover, setDropHover] = useState<null | 'drop' | 'animate'>(null);
  const startedHoverTimeout = useRef<NodeJS.Timeout>(undefined);

  useEffect(() => {
    addRef?.(node.item, {
      rename: () => {
        if (getEditOptions != null) {
          setEditing(true);
        }
      },
      isRenaming: editing,
    });
  }, [addRef, editing, getEditOptions, node.item]);

  const isAncestorCollapsedAtom = useMemo(
    () =>
      selectAtom(
        collapsedFamily(treeId),
        (collapsed) => {
          const next = (n: TreeNode<T>) => {
            if (n.parent == null) return false;
            if (collapsed[n.parent.item.id]) return true;
            return next(n.parent);
          };
          return next(node);
        },
        (a, b) => a === b, // re-render only when boolean flips
      ),
    [node, treeId],
  );

  const [showContextMenu, setShowContextMenu] = useState<{
    items: DropdownItem[];
    x: number;
    y: number;
  } | null>(null);

  useEffect(
    function scrollIntoViewWhenSelected() {
      return jotaiStore.sub(isSelectedFamily({ treeId, itemId: node.item.id }), () => {
        listItemRef.current?.scrollIntoView({ block: 'nearest' });
      });
    },
    [node.item.id, treeId],
  );

  const handleClick = useCallback(
    function handleClick(e: MouseEvent<HTMLButtonElement>) {
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
      onClick?.(node.item, { shiftKey: false, ctrlKey: false, metaKey: false });
      // Slight delay for the model to propagate to the local store
      setTimeout(() => setEditing(false), 200);
    },
    [getEditOptions, node.item, onClick],
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
          if (editing) {
            e.preventDefault();
            await handleSubmitNameEdit(e.currentTarget);
          }
          break;
        case 'Escape':
          e.preventDefault();
          setEditing(false);
          break;
      }
    },
    [editing, handleSubmitNameEdit],
  );

  const handleDoubleClick = useCallback(() => {
    const isFolder = node.children != null;
    if (isFolder) {
      toggleCollapsed();
    } else if (getEditOptions != null) {
      setEditing(true);
    }
  }, [getEditOptions, node.children, toggleCollapsed]);

  const clearDropHover = () => {
    if (startedHoverTimeout.current) {
      clearTimeout(startedHoverTimeout.current);
      startedHoverTimeout.current = undefined;
    }
    setDropHover(null);
  };

  // Toggle auto-expand of folders when hovering over them
  useDndMonitor({
    onDragEnd() {
      clearDropHover();
    },
    onDragMove(e: DragMoveEvent) {
      const side = computeSideForDragMove(node.item.id, e);
      const isFolder = node.children != null;
      const hasChildren = (node.children?.length ?? 0) > 0;
      const isCollapsed = jotaiStore.get(isCollapsedFamily({ treeId, itemId: node.item.id }));
      if (isCollapsed && isFolder && hasChildren && side === 'below') {
        setDropHover('animate');
        clearTimeout(startedHoverTimeout.current);
        startedHoverTimeout.current = setTimeout(() => {
          jotaiStore.set(isCollapsedFamily({ treeId, itemId: node.item.id }), false);
          clearDropHover();
        }, HOVER_CLOSED_FOLDER_DELAY);
      } else if (isFolder && !hasChildren && side === 'below') {
        setDropHover('drop');
      } else {
        clearDropHover();
      }
    },
  });

  const handleContextMenu = useCallback(
    async (e: MouseEvent<HTMLElement>) => {
      if (getContextMenu == null) return;

      e.preventDefault();
      e.stopPropagation();
      const items = await getContextMenu(node.item);
      setShowContextMenu({ items, x: e.clientX, y: e.clientY });
    },
    [getContextMenu, node.item],
  );

  const handleCloseContextMenu = useCallback(() => {
    setShowContextMenu(null);
  }, []);

  const { attributes, listeners, setNodeRef: setDraggableRef } = useDraggable({ id: node.item.id });
  const { setNodeRef: setDroppableRef } = useDroppable({ id: node.item.id });

  const handlePointerDown = useCallback(
    function handlePointerDown(e: PointerEvent<HTMLButtonElement>) {
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

  if (useAtomValue(isAncestorCollapsedAtom)) return null;

  return (
    <li
      ref={listItemRef}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={node.children == null ? undefined : !isCollapsed}
      aria-selected={isSelected}
      onContextMenu={handleContextMenu}
      className={classNames(
        className,
        'tree-item',
        'h-sm',
        'grid grid-cols-[auto_minmax(0,1fr)]',
        editing && 'ring-1 focus-within:ring-focus',
        dropHover != null && 'relative z-10 ring-2 ring-primary',
        dropHover === 'animate' && 'animate-blinkRing',
        isSelected && 'selected',
      )}
    >
      <TreeIndentGuide treeId={treeId} depth={depth} parentId={node.parent?.item.id ?? null} />
      <div
        className={classNames(
          'text-text-subtle',
          'grid grid-cols-[auto_minmax(0,1fr)] items-center rounded-md',
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
          <button tabIndex={-1} className="h-full pl-[0.5rem]" onClick={toggleCollapsed}>
            <Icon
              icon={node.children.length === 0 ? 'dot' : 'chevron_right'}
              className={classNames(
                'transition-transform text-text-subtlest',
                'ml-auto',
                'w-[1rem] h-[1rem]',
                !isCollapsed && node.children.length > 0 && 'rotate-90',
              )}
            />
          </button>
        ) : (
          <span aria-hidden /> // Make the grid happy
        )}

        <button
          ref={handleSetDraggableRef}
          onPointerDown={handlePointerDown}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          disabled={editing}
          className="tree-item-inner px-2 focus:outline-none flex items-center gap-2 h-full whitespace-nowrap"
          {...attributes}
          {...listeners}
          tabIndex={isLastSelected ? 0 : -1}
        >
          {ItemLeftSlot != null && <ItemLeftSlot treeId={treeId} item={node.item} />}
          {getEditOptions != null && editing ? (
            (() => {
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
          ) : (
            <ItemInner treeId={treeId} item={node.item} />
          )}
        </button>
      </div>
    </li>
  );
}

// 1) Preserve generics through forwardRef:
const TreeItem_ = forwardRef(TreeItemInner) as <T extends { id: string }>(
  props: TreeItemProps<T> & RefAttributes<TreeItemHandle>,
) => ReactElement | null;

export const TreeItem = memo(
  TreeItem_,
  ({ node: prevNode, ...prevProps }, { node: nextNode, ...nextProps }) => {
    const nonEqualKeys = [];
    for (const key of Object.keys(prevProps)) {
      if (prevProps[key as keyof typeof prevProps] !== nextProps[key as keyof typeof nextProps]) {
        nonEqualKeys.push(key);
      }
    }
    if (nonEqualKeys.length > 0) {
      return false;
    }
    return nextProps.getItemKey(prevNode.item) === nextProps.getItemKey(nextNode.item);
  },
) as typeof TreeItem_;
