import classNames from 'classnames';
import { useAtom, useAtomValue } from 'jotai';
import { useCallback, useRef } from 'react';
import { useDrag, useDrop, type XYCoord } from 'react-dnd';
import { Icon } from '../Icon';
import type { TreeNode } from './atoms';
import { collapsedFamily } from './atoms';
import type { DragItem } from './dnd';
import { ItemTypes } from './dnd';
import type { TreeProps } from './Tree';

export interface TreeItemProps<T extends { id: string }>
  extends Pick<TreeProps<T>, 'renderRow' | 'treeId' | 'selectedIdAtom' | 'onSelect'> {
  node: TreeNode<T>;
  className?: string;
  onMove: (item: T, side: 'above' | 'below') => void;
  onEnd: (item: T) => void;
  onDragStart: (item: T) => void;
}

export function TreeItem<T extends { id: string }>({
  treeId,
  node,
  renderRow,
  selectedIdAtom,
  onMove,
  onDragStart,
  onEnd,
  onSelect,
  className,
}: TreeItemProps<T>) {
  const ref = useRef<HTMLLIElement>(null);
  const isSelected = useAtomValue(selectedIdAtom) == node.item.id;
  const [collapsedMap, setCollapsedMap] = useAtom(collapsedFamily(treeId));

  const handleSelect = useCallback(() => {
    onSelect?.(node.item);
  }, [node, onSelect]);

  const handleCollapse = useCallback(() => {
    setCollapsedMap((prev) => ({
      ...prev,
      [node.item.id]: !prev[node.item.id],
    }));
  }, [node.item.id, setCollapsedMap]);

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
    <li
      ref={ref}
      draggable
      className={classNames(
        className,
        '!tree-item h-sm grid grid-cols-[auto_minmax(0,1fr)] items-center rounded',
        isSelected && 'bg-surface-highlight',
      )}
    >
      <div className="flex h-full">
        {node.children != null && (
          <button className="h-full w-[2rem]" onClick={handleCollapse}>
            <Icon
              icon="chevron_right"
              className={classNames(
                'transition-transform text-text-subtlest',
                'mx-auto !h-[1rem] !w-[1rem]',
                node.children.length == 0 && 'opacity-0',
                !collapsedMap[node.item.id] && 'rotate-90',
              )}
            />
          </button>
        )}
      </div>
      <button
        onClick={handleSelect}
        onDoubleClick={handleCollapse}
        className={classNames(
          'w-full flex items-center gap-2 h-full',
          node.children == null && 'pl-[1rem]',
        )}
      >
        {node.icon && <Icon icon={node.icon} color="secondary" />}
        {renderRow(node.item)}
      </button>
    </li>
  );
}
