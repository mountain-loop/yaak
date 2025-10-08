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
  'renderRow' | 'treeId' | 'selectedIdAtom' | 'onSelect' | 'getItemKey'
> &
  Pick<TreeItemProps<T>, 'onMove' | 'onEnd' | 'onDragStart'> & {
    node: TreeNode<T>;
    onMove: (item: T, side: 'above' | 'below') => void;
    onEnd: (item: T) => void;
    onDragStart: (item: T) => void;
    depth: number;
    hoveredNode: TreeNode<T> | null;
    hoveredIndex: number | null;
  };

export function TreeItemList<T extends { id: string }>({
  treeId,
  node,
  hoveredNode,
  hoveredIndex,
  renderRow,
  selectedIdAtom,
  onSelect,
  getItemKey,
  onMove,
  onEnd,
  onDragStart,
  depth,
}: TreeItemListProps<T>) {
  const collapsedMap = useAtomValue(collapsedFamily(treeId));
  const isCollapsed = collapsedMap[node.item.id] === true;
  return (
    <>
      <TreeItem
        className="relative z-10"
        treeId={treeId}
        node={node}
        selectedIdAtom={selectedIdAtom}
        renderRow={renderRow}
        onSelect={onSelect}
        onMove={onMove}
        onEnd={onEnd}
        onDragStart={onDragStart}
      />
      {!isCollapsed && node.children != null && (
        <ul className="ml-[calc(1rem-0.5px)] pl-[calc(1rem-0.5px)] border-l border-l-border-subtle">
          {node.children.map((child, i) => (
            <Fragment key={getItemKey(child.item)}>
              {hoveredIndex === i && hoveredNode?.item.id === node.item.id && <DropMarker />}
              <TreeItemList
                treeId={treeId}
                node={child}
                selectedIdAtom={selectedIdAtom}
                renderRow={renderRow}
                onSelect={onSelect}
                onMove={onMove}
                onEnd={onEnd}
                onDragStart={onDragStart}
                depth={depth + 1}
                getItemKey={getItemKey}
                hoveredNode={hoveredNode}
                hoveredIndex={hoveredIndex}
              />
            </Fragment>
          ))}
          {hoveredIndex === node.children?.length && hoveredNode?.item.id === node.item.id && (
            <DropMarker />
          )}
        </ul>
      )}
    </>
  );
}
