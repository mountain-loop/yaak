import type { CSSProperties } from 'react';
import { Fragment } from 'react';
import type { SelectableTreeNode } from './common';
import type { TreeProps } from './Tree';
import { TreeDropMarker } from './TreeDropMarker';
import type { TreeItemHandle, TreeItemProps } from './TreeItem';
import { TreeItem } from './TreeItem';

export type TreeItemListProps<T extends { id: string }> = Pick<
  TreeProps<T>,
  'ItemInner' | 'ItemLeftSlotInner' | 'ItemRightSlot' | 'treeId' | 'getItemKey' | 'getEditOptions'
> &
  Pick<TreeItemProps<T>, 'onClick' | 'getContextMenu'> & {
    nodes: SelectableTreeNode<T>[];
    style?: CSSProperties;
    className?: string;
    forceDepth?: number;
    addTreeItemRef?: (item: T, n: TreeItemHandle | null) => void;
  };

export function TreeItemList<T extends { id: string }>({
  className,
  getItemKey,
  nodes,
  style,
  treeId,
  forceDepth,
  addTreeItemRef,
  ...props
}: TreeItemListProps<T>) {
  return (
    <ul role="tree" style={style} className={className}>
      <TreeDropMarker node={null} treeId={treeId} index={0} />
      {nodes.map((child, i) => (
        <Fragment key={getItemKey(child.node.item)}>
          <TreeItem
            treeId={treeId}
            setRef={addTreeItemRef}
            node={child.node}
            getItemKey={getItemKey}
            depth={forceDepth == null ? child.depth : forceDepth}
            {...props}
          />
          <TreeDropMarker node={child.node} treeId={treeId} index={i + 1} />
        </Fragment>
      ))}
    </ul>
  );
}
