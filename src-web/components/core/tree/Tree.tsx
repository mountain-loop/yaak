import classNames from 'classnames';
import type { Atom } from 'jotai';
import { useAtomValue } from 'jotai';
import type { CSSProperties, ReactNode } from 'react';
import { Fragment, useCallback, useMemo, useRef } from 'react';
import { useDrop } from 'react-dnd';
import type { DragItem } from '../../sidebar/dnd';
import { ItemTypes } from '../../sidebar/dnd';
import type { FlatTreeNode, TreeNode } from './atoms';
import { collapsedFamily } from './atoms';
import type { TreeItemProps } from './TreeItem';
import { TreeItem } from './TreeItem';

export interface TreeProps<T> {
  root: TreeNode<T>;
  treeId: string;
  getItemKey: (item: T) => string;
  renderRow: (item: T) => ReactNode;
  className?: string;
  selectedIdAtom: Atom<string | null>;
  onSelect?: (item: T) => void;
}

export function Tree<T>({
  root,
  treeId,
  getItemKey,
  renderRow,
  className,
  selectedIdAtom,
  onSelect,
}: TreeProps<T>) {
  const treeRef = useRef<HTMLDivElement>(null);
  const collapsedMap = useAtomValue(collapsedFamily(treeId));

  const { flattened, maxDepth } = useMemo(() => {
    const out: FlatTreeNode<T>[] = [];
    let maxDepth = 0;
    const walk = (n: TreeNode<T>, depth: number) => {
      maxDepth = Math.max(maxDepth, depth);
      out.push({
        depth,
        id: n.id,
        node: n,
        icon: n.icon,
        count: n.children?.length ?? null,
        item: n.item,
      });
      const isCollapsed = collapsedMap[n.id] ?? false;
      if (n.children && !isCollapsed) {
        n.children.forEach((c) => walk(c, depth + 1));
      }
    };
    walk(root, 0);
    return { flattened: out, maxDepth };
  }, [collapsedMap, root]);

  const style = useMemo<CSSProperties>(
    () => ({ '--before-width': `${maxDepth * 2}rem` }) as CSSProperties,
    [maxDepth],
  );

  const handleMove = useCallback<TreeItemProps<T>['onMove']>((item: T) => {
    console.log('ON MOVE', item);
    // TODO
    // let hoveredTree = treeParentMap[id] ?? null;
    // const dragIndex = hoveredTree?.children.findIndex((n) => n.id === id) ?? -99;
    // const hoveredItem = hoveredTree?.children[dragIndex] ?? null;
    // let hoveredIndex = dragIndex + (side === 'above' ? 0 : 1);
    //
    // const collapsedMap = jotaiStore.get(jotaiStore.get(sidebarCollapsedAtom));
    // const isHoveredItemCollapsed = hoveredItem != null ? collapsedMap[hoveredItem.id] : false;
    //
    // if (hoveredItem?.model === 'folder' && side === 'below' && !isHoveredItemCollapsed) {
    //   // Move into the folder if it's open and we're moving below it
    //   hoveredTree = hoveredTree?.children.find((n) => n.id === id) ?? null;
    //   hoveredIndex = 0;
    // }
    //
    // setHoveredTree(hoveredTree);
    // setHoveredIndex(hoveredIndex);
  }, []);

  const handleDragStart = useCallback<TreeItemProps<T>['onDragStart']>((item: T) => {
    console.log('DRAG START: ', item);
    // TODO
    // setDraggingId(id);
  }, []);

  const handleMoveToSidebarEnd = useCallback(() => {
    console.log('ON MOVE SIDEBAR END');
    // TODO
    // setHoveredTree(tree);
    // // Put at the end of the top tree
    // setHoveredIndex(tree?.children?.length ?? 0);
  }, []);

  const [, connectDrop] = useDrop<DragItem, void>(
    {
      accept: ItemTypes.REQUEST,
      hover: (_, monitor) => {
        if (treeRef.current == null) return;
        if (!monitor.isOver({ shallow: true })) return;
        handleMoveToSidebarEnd();
      },
    },
    [handleMoveToSidebarEnd],
  );

  connectDrop(treeRef);

  return (
    <div
      ref={treeRef}
      style={style}
      className={classNames(
        className,
        'relative',
        'before:z-0 before:w-[var(--before-width)]',
        'before:absolute before:inset-0 before:ml-[calc(1rem-0.5px)]',
        'before:bg-[repeating-linear-gradient(to_right,rgba(255,255,255,0.06)_0_1px,transparent_1px_2rem)]',
      )}
    >
      {flattened.map((node) => (
        <Fragment key={getItemKey(node.item)}>
          {/*{overId === node.id && dropLinePosition === 'top' && <DropMarker />}*/}
          <TreeItem
            className="relative z-10 bg-surface"
            treeId={treeId}
            node={node}
            selectedIdAtom={selectedIdAtom}
            renderRow={renderRow}
            onSelect={onSelect}
            onMove={handleMove}
            onEnd={handleMoveToSidebarEnd}
            onDragStart={handleDragStart}
          />
          {/*{overId === node.id && dropLinePosition === 'bottom' && <DropMarker />}*/}
        </Fragment>
      ))}
    </div>
  );
}
