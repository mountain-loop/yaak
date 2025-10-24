import type { CSSProperties } from 'react';
import { Fragment, memo } from 'react';
import type { SelectableTreeNode } from './common';
import type { TreeProps } from './Tree';
import { TreeDropMarker } from './TreeDropMarker';
import type { TreeItemHandle, TreeItemProps } from './TreeItem';
import { TreeItem } from './TreeItem';

export type TreeItemListProps<T extends { id: string }> = Pick<
  TreeProps<T>,
  'ItemInner' | 'ItemLeftSlot' | 'treeId' | 'getItemKey' | 'getEditOptions'
> &
  Pick<TreeItemProps<T>, 'onClick' | 'getContextMenu'> & {
    nodes: SelectableTreeNode<T>[];
    style?: CSSProperties;
    className?: string;
    forceDepth?: number;
    addTreeItemRef?: (item: T, n: TreeItemHandle | null) => void;
  };

function TreeItemList_<T extends { id: string }>({
  className,
  getContextMenu,
  getEditOptions,
  getItemKey,
  nodes,
  onClick,
  ItemInner,
  ItemLeftSlot,
  style,
  treeId,
  forceDepth,
  addTreeItemRef,
}: TreeItemListProps<T>) {
  return (
    <ul role="tree" style={style} className={className}>
      <TreeDropMarker node={null} treeId={treeId} index={0} />
      {nodes.map((child, i) => (
        <Fragment key={getItemKey(child.node.item)}>
          <TreeItem
            addRef={addTreeItemRef}
            treeId={treeId}
            node={child.node}
            ItemInner={ItemInner}
            ItemLeftSlot={ItemLeftSlot}
            onClick={onClick}
            getEditOptions={getEditOptions}
            getContextMenu={getContextMenu}
            getItemKey={getItemKey}
            depth={forceDepth == null ? child.depth : forceDepth}
          />
          <TreeDropMarker node={child.node} treeId={treeId} index={i + 1} />
        </Fragment>
      ))}
    </ul>
  );
}

export const TreeItemList = memo(
  TreeItemList_,
  (
    { nodes: prevNodes, getItemKey: prevGetItemKey, ...prevProps },
    { nodes: nextNodes, getItemKey: nextGetItemKey, ...nextProps },
  ) => {
    const nonEqualKeys = [];
    for (const key of Object.keys(prevProps)) {
      if (prevProps[key as keyof typeof prevProps] !== nextProps[key as keyof typeof nextProps]) {
        nonEqualKeys.push(key);
      }
    }
    if (nonEqualKeys.length > 0) {
      // console.log('TreeItemList: ', nonEqualKeys);
      return false;
    }
    if (prevNodes.length !== nextNodes.length) return false;

    for (let i = 0; i < prevNodes.length; i++) {
      const prev = prevNodes[i]!;
      const next = nextNodes[i]!;
      if (prevGetItemKey(prev.node.item) !== nextGetItemKey(next.node.item)) {
        return false;
      }
    }

    return true;
  },
) as typeof TreeItemList_;
