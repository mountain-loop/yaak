import classNames from 'classnames';
import { useAtom, useAtomValue } from 'jotai';
import { useCallback, useMemo } from 'react';
import { Icon } from '../Icon';
import type { FlatTreeNode } from './atoms';
import { collapsedFamily } from './atoms';
import type { TreeProps } from './Tree';

export interface TreeItemProps<T>
  extends Pick<TreeProps<T>, 'renderRow' | 'treeId' | 'selectedIdAtom' | 'onSelect'> {
  node: FlatTreeNode<T>;
  className?: string;
  onMove: (item: T, side: 'above' | 'below') => void;
  onEnd: (item: T) => void;
  onDragStart: (item: T) => void;
}

export function TreeItem<T>({
  treeId,
  node,
  renderRow,
  selectedIdAtom,
  onSelect,
  className,
}: TreeItemProps<T>) {
  const isSelected = useAtomValue(selectedIdAtom) == node.id;
  const [collapsedMap, setCollapsedMap] = useAtom(collapsedFamily(treeId));

  const handleSelect = useCallback(() => {
    onSelect?.(node.item);
  }, [node, onSelect]);

  const handleCollapse = useCallback(() => {
    setCollapsedMap((prev) => ({
      ...prev,
      [node.id]: !prev[node.id],
    }));
  }, [node.id, setCollapsedMap]);

  const style = useMemo(
    () => ({
      marginLeft: `${node.depth * 2}rem`,
    }),
    [node.depth],
  );

  return (
    <div
      style={style}
      className={classNames(
        className,
        '!tree-item h-sm grid grid-cols-[auto_minmax(0,1fr)] items-center rounded',
        isSelected && 'bg-surface-highlight',
      )}
    >
      <div className="flex h-full">
        {node.count != null && (
          <button className="h-full w-[2rem]" onClick={handleCollapse}>
            <Icon
              icon="chevron_right"
              className={classNames(
                'transition-transform text-text-subtlest',
                'mx-auto !h-[1rem] !w-[1rem]',
                node.count == 0 && 'opacity-0',
                !collapsedMap[node.id] && 'rotate-90',
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
          node.count == null && 'pl-[1rem]',
        )}
      >
        {node.icon && <Icon icon={node.icon} color="secondary" />}
        {renderRow(node.item)}
      </button>
    </div>
  );
}
