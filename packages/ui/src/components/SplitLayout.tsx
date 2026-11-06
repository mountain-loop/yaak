import classNames from "classnames";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useLocalStorage } from "react-use";
import { useContainerSize } from "../hooks/useContainerSize";
import type { ResizeHandleEvent } from "./ResizeHandle";
import { ResizeHandle } from "./ResizeHandle";
import type { SplitDrag } from "./resizeDrag";
import { clampSplitRatio, createSplitDrag, splitGridTemplate } from "./resizeDrag";

export type SplitLayoutLayout = "responsive" | "horizontal" | "vertical";

export interface SlotProps {
  orientation: "horizontal" | "vertical";
  style: CSSProperties;
}

interface Props {
  storageKey: string;
  firstSlot: (props: SlotProps) => ReactNode;
  secondSlot: null | ((props: SlotProps) => ReactNode);
  style?: CSSProperties;
  className?: string;
  defaultRatio?: number;
  minHeightPx?: number;
  minWidthPx?: number;
  layout?: SplitLayoutLayout;
  resizeHandleClassName?: string;
}

const baseProperties = { minHeight: 0, minWidth: 0 };
const areaL = { ...baseProperties, gridArea: "left" };
const areaR = { ...baseProperties, gridArea: "right" };
const areaD = { ...baseProperties, gridArea: "drag" };

const STACK_VERTICAL_WIDTH = 500;

export function SplitLayout({
  style,
  firstSlot,
  secondSlot,
  className,
  storageKey,
  layout = "responsive",
  resizeHandleClassName,
  defaultRatio = 0.5,
  minHeightPx = 10,
  minWidthPx = 10,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [widthRaw, setWidth] = useLocalStorage<number>(`${storageKey}_width`);
  const [heightRaw, setHeight] = useLocalStorage<number>(`${storageKey}_height`);
  const width = widthRaw ?? defaultRatio;
  let height = heightRaw ?? defaultRatio;

  if (!secondSlot) {
    height = 0;
    minHeightPx = 0;
  }

  const size = useContainerSize(containerRef);
  const verticalBasedOnSize = size.width !== 0 && size.width < STACK_VERTICAL_WIDTH;
  const vertical = layout !== "horizontal" && (layout === "vertical" || verticalBasedOnSize);
  const renderedWidth = clampSplitRatio(width, minWidthPx, size.width);
  const renderedHeight = secondSlot ? clampSplitRatio(height, minHeightPx, size.height) : 0;

  const styles = useMemo<CSSProperties>(
    () => ({
      ...style,
      gridTemplate: splitGridTemplate(vertical, vertical ? renderedHeight : renderedWidth),
    }),
    [style, vertical, renderedHeight, renderedWidth],
  );

  // While dragging, the split is written straight to the DOM and only saved (and rendered) when
  // the drag ends, so the panes are not re-rendered on every move.
  const liveDrag = useRef<SplitDrag | null>(null);

  const applySplit = useCallback((vertical: boolean, ratio: number) => {
    if (containerRef.current == null) return;
    containerRef.current.style.gridTemplate = splitGridTemplate(vertical, ratio);
  }, []);

  // Something else re-rendering mid-drag (a response arriving, say) may write the saved split
  // back; put the live one back before it is painted.
  useLayoutEffect(() => {
    const d = liveDrag.current;
    if (d?.ratio != null) applySplit(d.vertical, d.ratio);
  });

  const handleReset = useCallback(() => {
    if (vertical) setHeight(defaultRatio);
    else setWidth(defaultRatio);
  }, [vertical, setHeight, defaultRatio, setWidth]);

  const handleResizeStart = useCallback(() => {
    liveDrag.current = createSplitDrag({
      vertical,
      startRatio: vertical ? renderedHeight : renderedWidth,
      minPx: vertical ? minHeightPx : minWidthPx,
      measure: () => {
        const $c = containerRef.current;
        if ($c == null) return 0;
        const { paddingLeft, paddingRight, paddingTop, paddingBottom } = getComputedStyle($c);
        return vertical
          ? $c.clientHeight - Number.parseFloat(paddingTop) - Number.parseFloat(paddingBottom)
          : $c.clientWidth - Number.parseFloat(paddingLeft) - Number.parseFloat(paddingRight);
      },
      apply: (ratio) => applySplit(vertical, ratio),
      commit: (ratio) => (vertical ? setHeight(ratio) : setWidth(ratio)),
    });
  }, [
    vertical,
    renderedHeight,
    renderedWidth,
    minHeightPx,
    minWidthPx,
    applySplit,
    setHeight,
    setWidth,
  ]);

  const handleResizeMove = useCallback((e: ResizeHandleEvent) => liveDrag.current?.move(e), []);

  const handleResizeEnd = useCallback(() => {
    const d = liveDrag.current;
    liveDrag.current = null;
    d?.end();
  }, []);

  // The container's size changes often (another splitter being dragged, the window resizing) and
  // re-renders this component; reuse the slots then, so the panes are only re-rendered when the
  // owner re-renders or the orientation flips.
  const orientation = vertical ? "vertical" : "horizontal";
  const first = useMemo(() => firstSlot({ style: areaL, orientation }), [firstSlot, orientation]);
  const second = useMemo(
    () => secondSlot?.({ style: areaR, orientation }) ?? null,
    [secondSlot, orientation],
  );

  return (
    <div
      ref={containerRef}
      style={styles}
      className={classNames(className, "grid w-full h-full overflow-hidden")}
    >
      {first}
      {secondSlot && (
        <>
          <ResizeHandle
            style={areaD}
            className={classNames(
              resizeHandleClassName,
              vertical ? "-translate-y-1" : "-translate-x-1",
            )}
            onResizeStart={handleResizeStart}
            onResizeMove={handleResizeMove}
            onResizeEnd={handleResizeEnd}
            onReset={handleReset}
            side={vertical ? "top" : "left"}
            justify="center"
          />
          {second}
        </>
      )}
    </div>
  );
}
