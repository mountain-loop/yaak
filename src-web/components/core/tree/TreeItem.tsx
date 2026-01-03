import type { DragMoveEvent } from '@dnd-kit/core';
import { useDndContext, useDndMonitor, useDraggable, useDroppable } from '@dnd-kit/core';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { selectAtom } from 'jotai/utils';
import type {
  MouseEvent,
  PointerEvent,
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeSideForDragMove } from '../../../lib/dnd';
import { jotaiStore } from '../../../lib/jotai';
import type { ContextMenuProps, DropdownItem } from '../Dropdown';
import { ContextMenu } from '../Dropdown';
import { Icon } from '../Icon';
import { collapsedFamily, isCollapsedFamily, isLastFocusedFamily, isSelectedFamily } from './atoms';
import type { TreeNode } from './common';
import { getNodeKey } from './common';
import type { TreeProps } from './Tree';
import { TreeIndentGuide } from './TreeIndentGuide';

export interface TreeItemClickEvent {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export type TreeItemProps<T extends { id: string }> = Pick<
  TreeProps<T>,
  'ItemInner' | 'ItemLeftSlotInner' | 'ItemRightSlot' | 'treeId' | 'getEditOptions' | 'getItemKey'
> & {
  node: TreeNode<T>;
  className?: string;
  onClick?: (item: T, e: TreeItemClickEvent) => void;
  getContextMenu?: (item: T) => ContextMenuProps['items'] | Promise<ContextMenuProps['items']>;
  depth: number;
  setRef?: (item: T, n: TreeItemHandle | null) => void;
};

export interface TreeItemHandle {
  rename: () => void;
  isRenaming: boolean;
  rect: () => DOMRect;
  focus: () => void;
  scrollIntoView: () => void;
}

const HOVER_CLOSED_FOLDER_DELAY = 800;

function TreeItem_<T extends { id: string }>({
  treeId,
  node,
  ItemInner,
  ItemLeftSlotInner,
  ItemRightSlot,
  getContextMenu,
  onClick,
  getEditOptions,
  className,
  depth,
  setRef,
}: TreeItemProps<T>) {
  const listItemRef = useRef<HTMLLIElement>(null);
  const draggableRef = useRef<HTMLButtonElement>(null);
  const isSelected = useAtomValue(isSelectedFamily({ treeId, itemId: node.item.id }));
  const isCollapsed = useAtomValue(isCollapsedFamily({ treeId, itemId: node.item.id }));
  const isLastSelected = useAtomValue(isLastFocusedFamily({ treeId, itemId: node.item.id }));
  const [editing, setEditing] = useState<boolean>(false);
  const [dropHover, setDropHover] = useState<null | 'drop' | 'animate'>(null);
  const startedHoverTimeout = useRef<NodeJS.Timeout>(undefined);
  const handle = useMemo<TreeItemHandle>(
    () => ({
      focus: () => {
        draggableRef.current?.focus();
      },
      rename: () => {
        if (getEditOptions != null) {
          setEditing(true);
        }
      },
      isRenaming: editing,
      rect: () => {
        if (listItemRef.current == null) {
          return new DOMRect(0, 0, 0, 0);
        }
        return listItemRef.current.getBoundingClientRect();
      },
      scrollIntoView: () => {
        listItemRef.current?.scrollIntoView({ block: 'nearest' });
      },
    }),
    [editing, getEditOptions],
  );

  useEffect(() => {
    setRef?.(node.item, handle);
  }, [setRef, handle, node.item]);

  const ancestorIds = useMemo(() => {
    const ids: string[] = [];
    let p = node.parent;

    while (p) {
      ids.push(p.item.id);
      p = p.parent;
    }

    return ids;
  }, [node]);

  const isAncestorCollapsedAtom = useMemo(
    () =>
      selectAtom(
        collapsedFamily(treeId),
        (collapsed) => ancestorIds.some((id) => collapsed[id]),
        (a, b) => a === b,
      ),
    [ancestorIds, treeId],
  );
  const isAncestorCollapsed = useAtomValue(isAncestorCollapsedAtom);

  const [showContextMenu, setShowContextMenu] = useState<{
    items: DropdownItem[];
    x: number;
    y: number;
  } | null>(null);

  const handleClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => onClick?.(node.item, e),
    [node, onClick],
  );

  const toggleCollapsed = useCallback(() => {
    jotaiStore.set(isCollapsedFamily({ treeId, itemId: node.item.id }), (prev) => !prev);
  }, [node.item.id, treeId]);

  const handleSubmitNameEdit = useCallback(
    async (el: HTMLInputElement) => {
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
    async function editBlur(e: ReactFocusEvent<HTMLInputElement>) {
      await handleSubmitNameEdit(e.currentTarget);
    },
    [handleSubmitNameEdit],
  );

  const handleEditKeyDown = useCallback(
    async (e: ReactKeyboardEvent<HTMLInputElement>) => {
      e.stopPropagation(); // Don't trigger other tree keys (like arrows)
      switch (e.key) {
        case 'Enter':
          if (editing) {
            e.preventDefault();
            await handleSubmitNameEdit(e.currentTarget);
          }
          break;
        case 'Escape':
          if (editing) {
            e.preventDefault();
            setEditing(false);
          }
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

  const dndContext = useDndContext();

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
          // Force re-measure everything because all containers below the folder have been pushed down
          requestAnimationFrame(() => {
            dndContext.measureDroppableContainers(
              dndContext.droppableContainers.toArray().map((c) => c.id),
            );
          });
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

      // Set data attribute on the list item to preserve active state
      if (listItemRef.current) {
        listItemRef.current.setAttribute('data-context-menu-open', 'true');
      }

      const items = await getContextMenu(node.item);
      setShowContextMenu({ items, x: e.clientX ?? 100, y: e.clientY ?? 100 });
    },
    [getContextMenu, node.item],
  );

  const handleCloseContextMenu = useCallback(() => {
    // Remove data attribute when context menu closes
    if (listItemRef.current) {
      listItemRef.current.removeAttribute('data-context-menu-open');
    }
    setShowContextMenu(null);
  }, []);

  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
  } = useDraggable({ id: node.item.id, disabled: node.draggable === false || editing });

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

  if (node.hidden || isAncestorCollapsed) return null;

  return (
    <li
      ref={listItemRef}
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
      <TreeIndentGuide treeId={treeId} depth={depth} ancestorIds={ancestorIds} />
      <div
        className={classNames(
          'text-text-subtle',
          'grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2 items-center rounded-md',
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
            type="button"
            tabIndex={-1}
            className="h-full pl-[0.5rem] outline-none"
            onClick={toggleCollapsed}
          >
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
          className="cursor-default tree-item-inner pr-1 focus:outline-none flex items-center gap-2 h-full whitespace-nowrap"
          {...attributes}
          {...listeners}
          tabIndex={isLastSelected ? 0 : -1}
        >
          {ItemLeftSlotInner != null && <ItemLeftSlotInner treeId={treeId} item={node.item} />}
          {getEditOptions != null && editing ? (
            (() => {
              const { defaultValue, placeholder } = getEditOptions(node.item);
              return (
                <input
                  data-disable-hotkey
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
        {ItemRightSlot != null ? (
          <ItemRightSlot treeId={treeId} item={node.item} />
        ) : (
          <span aria-hidden />
        )}
      </div>
    </li>
  );
}

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

    return (
      getNodeKey(prevNode, prevProps.getItemKey) === getNodeKey(nextNode, nextProps.getItemKey)
    );
  },
) as typeof TreeItem_;
