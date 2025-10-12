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
  'renderItem' | 'renderLeftSlot' | 'treeId' | 'activeIdAtom' | 'getItemKey' | 'getEditOptions'
> &
  Pick<TreeItemProps<T>, 'onMove' | 'onEnd' | 'onDragStart' | 'onClick' | 'getContextMenu'> & {
    node: TreeNode<T>;
    depth: number;
    style?: CSSProperties;
  };

function TreeItemList_<T extends { id: string }>({
  treeId,
  node,
  renderItem,
  renderLeftSlot,
  activeIdAtom,
  onClick,
  getItemKey,
  getContextMenu,
  onMove,
  onEnd,
  onDragStart,
  getEditOptions,
  depth,
  style,
}: TreeItemListProps<T>) {
  const isHovered = useAtomValue(isParentHoveredFamily({ treeId, parentId: node.item.id }));
  const isCollapsed = useAtomValue(isCollapsedFamily({ treeId, itemId: node.item.id }));
  const childList = !isCollapsed && node.children != null && (
    <ul
      style={style}
      className={classNames(
        depth > 0 && 'ml-[calc(0.7rem+0.5px)] pl-[0.7rem] border-l',
        isHovered ? 'border-l-primary' : 'border-l-border-subtle',
      )}
    >
      {node.children.map(function mapChild(child, i) {
        return (
          <Fragment key={getItemKey(child.item)}>
            <TreeDropMarker treeId={treeId} parent={node} index={i} className="-ml-[0.7rem]" />
            <TreeItemList
              treeId={treeId}
              node={child}
              activeIdAtom={activeIdAtom}
              renderItem={renderItem}
              renderLeftSlot={renderLeftSlot}
              onClick={onClick}
              onMove={onMove}
              onEnd={onEnd}
              onDragStart={onDragStart}
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
        // className={classNames(isHovered && isCollapsed && 'bg-surface-highlight text-text')}
        node={node}
        activeIdAtom={activeIdAtom}
        getContextMenu={getContextMenu}
        renderItem={renderItem}
        renderLeftSlot={renderLeftSlot}
        onClick={onClick}
        getEditOptions={getEditOptions}
        onMove={onMove}
        onEnd={onEnd}
        onDragStart={onDragStart}
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

function TreeDropMarker<T extends { id: string }>({
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
}
