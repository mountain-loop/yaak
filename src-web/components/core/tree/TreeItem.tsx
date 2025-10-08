import classNames from 'classnames';
import { useAtom, useAtomValue } from 'jotai';
import { type MouseEvent, useCallback, useRef } from 'react';
import { useDrag, useDrop, type XYCoord } from 'react-dnd';
import { Icon } from '../Icon';
import type { TreeNode } from './atoms';
import { collapsedFamily, selectedFamily } from './atoms';
import type { DragItem } from './dnd';
import { ItemTypes } from './dnd';
import type { TreeProps } from './Tree';

export type TreeItemProps<T extends { id: string }> = Pick<
  TreeProps<T>,
  'renderItem' | 'treeId' | 'activeIdAtom'
> & {
  node: TreeNode<T>;
  className?: string;
  onMove: (item: T, side: 'above' | 'below') => void;
  onEnd: (item: T) => void;
  onDragStart: (item: T) => void;
  onClick: (item: T, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => void;
};

export function TreeItem<T extends { id: string }>({
  treeId,
  node,
  renderItem,
  activeIdAtom,
  onMove,
  onDragStart,
  onEnd,
  onClick,
  className,
}: TreeItemProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const isActive = useAtomValue(activeIdAtom) == node.item.id;
  const selectedIds = useAtomValue(selectedFamily(treeId));
  const isSelected = selectedIds.includes(node.item.id);
  const [collapsedMap, setCollapsedMap] = useAtom(collapsedFamily(treeId));

  const handleClick = useCallback(
    ({ shiftKey, ctrlKey, metaKey }: MouseEvent<HTMLButtonElement>) => {
      onClick?.(node.item, { shiftKey, ctrlKey, metaKey });
    },
    [node, onClick],
  );

  const handleDoubleClick = useCallback(() => {
    if (node.children != null) {
      setCollapsedMap((prev) => ({
        ...prev,
        [node.item.id]: !prev[node.item.id],
      }));
    }
  }, [node.children, node.item, setCollapsedMap]);

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
        // Cancel drag when editing
        // TODO: Editing
        // if (editing) return null;
        onDragStart(node.item);
        return { id: node.item.id };
      },
      collect: (m) => ({ isDragging: m.isDragging() }),
      options: { dropEffect: 'move' },
      end: () => onEnd(node.item),
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
        onMove(node.item, hoverClientY < hoverMiddleY ? 'above' : 'below');
      },
    },
    [onMove],
  );

  connectDrag(connectDrop(ref));

  return (
    <div
      ref={ref}
      draggable
      className={classNames(
        className,
        'h-sm grid grid-cols-[auto_minmax(0,1fr)] items-center rounded',
        isActive ? 'bg-surface-active' : isSelected ? 'bg-surface-highlight' : null,
      )}
    >
      {node.children != null ? (
        <button className="h-full w-[2.6rem] pr-[0.4rem] -ml-[1rem]" onClick={handleDoubleClick}>
          <Icon
            icon="chevron_right"
            className={classNames(
              'transition-transform text-text-subtlest',
              'ml-auto !h-[1rem] !w-[1rem]',
              node.children.length == 0 && 'opacity-0',
              !collapsedMap[node.item.id] && 'rotate-90',
            )}
          />
        </button>
      ) : (
        <span />
      )}
      <button
        onClick={handleClick}
        className={classNames(
          'flex items-center gap-2 h-full',
          // node.children == null && 'pl-[1rem]',
          isActive ? 'text-text' : 'text-text-subtle',
        )}
      >
        {node.icon ? <Icon icon={node.icon} /> : <span />}
        {renderItem(node.item)}
      </button>
    </div>
  );
}
