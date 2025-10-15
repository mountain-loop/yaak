import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import type { CSSProperties } from 'react';
import { Fragment, memo } from 'react';
import { DropMarker } from '../../DropMarker';
import { isCollapsedFamily, isItemHoveredFamily, isParentHoveredFamily } from './atoms';
import type { TreeNode } from './common';
import { equalSubtree } from './common';
import type { TreeProps } from './Tree';
import type { TreeItemProps } from './TreeItem';
import { TreeItem } from './TreeItem';

export type TreeItemListProps<T extends { id: string }> = Pick<
  TreeProps<T>,
  'ItemInner' | 'ItemLeftSlot' | 'treeId' | 'getItemKey' | 'getEditOptions'
> &
  Pick<TreeItemProps<T>, 'onClick' | 'getContextMenu'> & {
    node: TreeNode<T>;
    depth: number;
    style?: CSSProperties;
    className?: string;
  };

function TreeItemList_<T extends { id: string }>({
  className,
  depth,
  getContextMenu,
  getEditOptions,
  getItemKey,
  node,
  onClick,
  ItemInner,
  ItemLeftSlot,
  style,
  treeId,
}: TreeItemListProps<T>) {
  const isHovered = useAtomValue(isParentHoveredFamily({ treeId, parentId: node.item.id }));
  const isCollapsed = useAtomValue(isCollapsedFamily({ treeId, itemId: node.item.id }));
  const childList = !isCollapsed && node.children != null && (
    <ul
      style={style}
      className={classNames(
        className,
        depth > 0 && 'ml-[calc(1.2rem+0.5px)] pl-[0.7rem] border-l',
        isHovered ? 'border-l-text-subtle' : 'border-l-border-subtle',
      )}
    >
      {node.children.map(function mapChild(child, i) {
        return (
          <Fragment key={getItemKey(child.item)}>
            <TreeDropMarker treeId={treeId} parent={node} index={i} />
            <TreeItemList
              treeId={treeId}
              node={child}
              ItemInner={ItemInner}
              ItemLeftSlot={ItemLeftSlot}
              onClick={onClick}
              getEditOptions={getEditOptions}
              depth={depth + 1}
              getItemKey={getItemKey}
              getContextMenu={getContextMenu}
            />
          </Fragment>
        );
      })}
      <TreeDropMarker treeId={treeId} parent={node ?? null} index={node.children?.length ?? 0} />
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
        getContextMenu={getContextMenu}
        ItemInner={ItemInner}
        ItemLeftSlot={ItemLeftSlot}
        onClick={onClick}
        getEditOptions={getEditOptions}
      />
      {childList}
    </li>
  );
}

export const TreeItemList = memo(
  TreeItemList_,
  ({ node: prevNode, ...prevProps }, { node: nextNode, ...nextProps }) => {
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
    return equalSubtree(prevNode, nextNode, nextProps.getItemKey);
  },
) as typeof TreeItemList_;

const TreeDropMarker = memo(function TreeDropMarker<T extends { id: string }>({
  className,
  treeId,
  parent,
  index,
}: {
  treeId: string;
  parent: TreeNode<T> | null;
  index: number;
  className?: string;
}) {
  const isHovered = useAtomValue(isItemHoveredFamily({ treeId, parentId: parent?.item.id, index }));
  const isLastItem = parent?.children?.length === index;
  const isLastItemHovered = useAtomValue(
    isItemHoveredFamily({
      treeId,
      parentId: parent?.item.id,
      index: parent?.children?.length ?? 0,
    }),
  );

  if (!isHovered && !(isLastItem && isLastItemHovered)) return null;

  return <DropMarker className={classNames(className)} />;
});
