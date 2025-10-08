import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { Fragment } from 'react';
import { DropMarker } from '../../DropMarker';
import type { TreeNode } from './atoms';
import { collapsedFamily } from './atoms';
import type { TreeProps } from './Tree';
import type { TreeItemProps } from './TreeItem';
import { TreeItem } from './TreeItem';

export type TreeItemListProps<T extends { id: string }> = Pick<
  TreeProps<T>,
  'renderItem' | 'treeId' | 'activeIdAtom' | 'getItemKey'
> &
  Pick<TreeItemProps<T>, 'onMove' | 'onEnd' | 'onDragStart' | 'onClick'> & {
    node: TreeNode<T>;
    onMove: (item: T, side: 'above' | 'below') => void;
    onEnd: (item: T) => void;
    onDragStart: (item: T) => void;
    depth: number;
    hoveredParent: TreeNode<T> | null;
    hoveredIndex: number | null;
  };

export function TreeItemList<T extends { id: string }>({
  treeId,
  node,
  hoveredParent,
  hoveredIndex,
  renderItem,
  activeIdAtom,
  onClick,
  getItemKey,
  onMove,
  onEnd,
  onDragStart,
  depth,
}: TreeItemListProps<T>) {
  const collapsedMap = useAtomValue(collapsedFamily(treeId));
  const isCollapsed = collapsedMap[node.item.id] === true;

  const childList = !isCollapsed && node.children != null && (
    <ul
      className={classNames(
        depth > 0 && 'ml-[calc(0.6rem+1px)] pl-[calc(0.6rem)] border-l',
        hoveredParent?.item.id === node.item.id
          ? 'border-l-text-subtlest'
          : 'border-l-border-subtle',
      )}
    >
      {node.children.map((child, i) => (
        <Fragment key={getItemKey(child.item)}>
          {hoveredIndex === i && hoveredParent?.item.id === node.item.id && <DropMarker />}
          <TreeItemList
            treeId={treeId}
            node={child}
            activeIdAtom={activeIdAtom}
            renderItem={renderItem}
            onClick={onClick}
            onMove={onMove}
            onEnd={onEnd}
            onDragStart={onDragStart}
            depth={depth + 1}
            getItemKey={getItemKey}
            hoveredParent={hoveredParent}
            hoveredIndex={hoveredIndex}
          />
        </Fragment>
      ))}
      {hoveredIndex === node.children?.length && hoveredParent?.item.id === node.item.id && (
        <DropMarker />
      )}
    </ul>
  );

  if (depth === 0) {
    return childList;
  }

  return (
    <li>
      <TreeItem
        treeId={treeId}
        node={node}
        activeIdAtom={activeIdAtom}
        renderItem={renderItem}
        onClick={onClick}
        onMove={onMove}
        onEnd={onEnd}
        onDragStart={onDragStart}
      />
      {childList}
    </li>
  );
}
