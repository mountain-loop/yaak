import type { Virtualizer } from "@tanstack/react-virtual";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAtomValue } from "jotai";
import type { CSSProperties } from "react";
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import { draggingIdsFamily } from "./atoms";
import type { SelectableTreeNode } from "./common";
import type { TreeProps } from "./Tree";
import { TreeDropMarker } from "./TreeDropMarker";
import type { TreeItemHandle, TreeItemProps } from "./TreeItem";
import { TreeItem } from "./TreeItem";

export type TreeItemListProps<T extends { id: string }> = Pick<
  TreeProps<T>,
  | "ItemInner"
  | "ItemLeftSlotInner"
  | "ItemRightSlot"
  | "treeId"
  | "getItemKey"
  | "getEditOptions"
  | "renderContextMenu"
> &
  Pick<TreeItemProps<T>, "onClick" | "getContextMenu"> & {
    nodes: SelectableTreeNode<T>[];
    style?: CSSProperties;
    className?: string;
    forceDepth?: number;
    addTreeItemRef?: (item: T, n: TreeItemHandle | null) => void;
    /**
     * Enable virtualization by providing the scroll container. Rows are then
     * windowed with @tanstack/react-virtual and only visible rows mount.
     */
    getScrollElement?: () => HTMLElement | null;
    onVirtualizerReady?: (v: Virtualizer<HTMLElement, Element>) => void;
  };

export function TreeItemList<T extends { id: string }>(props: TreeItemListProps<T>) {
  if (props.getScrollElement != null) {
    return <VirtualTreeItemList {...props} getScrollElement={props.getScrollElement} />;
  }
  return <StaticTreeItemList {...props} />;
}

function StaticTreeItemList<T extends { id: string }>({
  className,
  getItemKey,
  nodes,
  style,
  treeId,
  forceDepth,
  addTreeItemRef,
  getScrollElement: _getScrollElement,
  onVirtualizerReady: _onVirtualizerReady,
  ...props
}: TreeItemListProps<T>) {
  return (
    <ul style={style} className={className}>
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

// Rows are --height-sm (2rem). Derive the pixel estimate from the actual root
// font size so scroll math stays accurate under interface scaling.
function estimateRowHeightPx() {
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return 2 * rem;
}

function VirtualTreeItemList<T extends { id: string }>({
  className,
  getItemKey,
  nodes,
  style,
  treeId,
  forceDepth,
  addTreeItemRef,
  getScrollElement,
  onVirtualizerReady,
  ...props
}: TreeItemListProps<T> & { getScrollElement: () => HTMLElement | null }) {
  const listRef = useRef<HTMLUListElement>(null);

  // Offset of the list within the scroll container (eg. container padding),
  // so windowing and scrollToIndex targets aren't shifted by it
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const list = listRef.current;
    const scroller = getScrollElement();
    if (list == null || scroller == null) return;
    const offset =
      list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    setScrollMargin(offset);
  }, [getScrollElement]);

  const virtualizer = useVirtualizer({
    count: nodes.length,
    getScrollElement,
    estimateSize: estimateRowHeightPx,
    overscan: 10,
    scrollMargin,
  });

  useLayoutEffect(() => {
    onVirtualizerReady?.(virtualizer);
  }, [virtualizer, onVirtualizerReady]);

  const virtualItems = virtualizer.getVirtualItems();

  // Rows being dragged stay mounted even after they scroll out of the window.
  //
  // dnd-kit keeps a live reference to the node being dragged and re-measures it whenever that
  // node is replaced. Its scroll adjustment is a delta against a baseline captured when that rect
  // was last measured, and re-measuring resets the baseline to wherever the list happens to be
  // scrolled right then, discarding the scroll accumulated so far. Letting the dragged row unmount
  // mid-drag therefore corrupts every coordinate dnd-kit derives, by a bit more each time it
  // happens, which is why the drop indicator drifts further the longer a drag autoscrolls.
  const draggingIds = useAtomValue(draggingIdsFamily(treeId));
  const pinnedIndexes = useMemo(() => {
    if (draggingIds.length === 0) return [];
    const rendered = new Set(virtualItems.map((v) => v.index));
    const out: number[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node == null || rendered.has(i)) continue;
      if (draggingIds.includes(node.node.item.id)) out.push(i);
    }
    return out;
    // biome-ignore lint/correctness/useExhaustiveDependencies: keyed off the rendered range
  }, [draggingIds, nodes, virtualItems]);

  const renderRow = (index: number, start: number, measure: boolean) => {
    const child = nodes[index];
    if (child == null) return null;
    return (
      <div
        // Key by item so window shifts don't remount rows unnecessarily
        key={getItemKey(child.node.item)}
        ref={measure ? virtualizer.measureElement : undefined}
        data-index={index}
        className="tree-row"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          transform: `translateY(${start - scrollMargin}px)`,
        }}
      >
        <TreeItem
          treeId={treeId}
          setRef={addTreeItemRef}
          node={child.node}
          getItemKey={getItemKey}
          depth={forceDepth == null ? child.depth : forceDepth}
          {...props}
        />
        <TreeDropMarker node={child.node} treeId={treeId} index={index + 1} />
      </div>
    );
  };

  return (
    <ul
      ref={listRef}
      style={{ ...style, height: `${virtualizer.getTotalSize()}px`, position: "relative" }}
      className={className}
    >
      <TreeDropMarker node={null} treeId={treeId} index={0} />
      {virtualItems.map((virtualItem) => renderRow(virtualItem.index, virtualItem.start, true))}
      {/* NOTE: Not measured. Measuring an out-of-window row would write its size into the
          virtualizer's cache under an index the window isn't tracking. */}
      {pinnedIndexes.map((index) =>
        renderRow(index, virtualizer.measurementsCache[index]?.start ?? 0, false),
      )}
    </ul>
  );
}
