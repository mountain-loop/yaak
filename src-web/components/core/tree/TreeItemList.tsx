import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { Fragment, memo } from 'react';
import { DropMarker } from '../../DropMarker';
import { isCollapsedFamily } from './atoms';
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
    hoveredParent?: TreeNode<T> | null;
    hoveredIndex?: number | null;
  };

function TreeItemList_<T extends { id: string }>({
  treeId,
  node,
  hoveredParent,
  hoveredIndex,
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
}: TreeItemListProps<T>) {
  const isCollapsed = useAtomValue(isCollapsedFamily({ treeId, itemId: node.item.id }));
  const childList = !isCollapsed && node.children != null && (
    <ul
      className={classNames(
        depth > 0 && 'ml-[calc(0.7rem+0.5px)] pl-[0.7rem] border-l',
        hoveredParent?.item.id === node.item.id
          ? 'border-l-primary'
          : 'border-l-border-subtle',
      )}
    >
      {node.children.map((child, i) => (
        <Fragment key={getItemKey(child.item)}>
          {hoveredIndex === i && hoveredParent?.item.id === node.item.id && <DropMarker className="-ml-[0.7rem]"/>}
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
      return false;
    }
    return equalSubtree(prevNode, nextNode, nextProps.getItemKey);
  },
) as typeof TreeItemList_;
