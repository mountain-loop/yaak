import classNames from "classnames";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useMemo, useRef } from "react";
import { useLocalStorage } from "react-use";
import { useContainerSize } from "../hooks/useContainerSize";
import { clamp } from "../lib/clamp";
import type { ResizeHandleEvent } from "./ResizeHandle";
import { ResizeHandle } from "./ResizeHandle";

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

  const styles = useMemo<CSSProperties>(() => {
    return {
      ...style,
      gridTemplate: vertical
        ? `
            ' ${areaL.gridArea}' minmax(0,${1 - renderedHeight}fr)
            ' ${areaD.gridArea}' 0
            ' ${areaR.gridArea}' minmax(0,${renderedHeight}fr)
            / 1fr
          `
        : `
            ' ${areaL.gridArea} ${areaD.gridArea} ${areaR.gridArea}' minmax(0,1fr)
            / ${1 - renderedWidth}fr    0                 ${renderedWidth}fr
          `,
    };
  }, [style, vertical, renderedHeight, renderedWidth]);

  const handleReset = useCallback(() => {
    if (vertical) setHeight(defaultRatio);
    else setWidth(defaultRatio);
  }, [vertical, setHeight, defaultRatio, setWidth]);

  const handleResizeMove = useCallback(
    (e: ResizeHandleEvent) => {
      if (containerRef.current === null) return;

      const { paddingLeft, paddingRight, paddingTop, paddingBottom } = getComputedStyle(
        containerRef.current,
      );
      const $c = containerRef.current;
      const containerWidth =
        $c.clientWidth - Number.parseFloat(paddingLeft) - Number.parseFloat(paddingRight);
      const containerHeight =
        $c.clientHeight - Number.parseFloat(paddingTop) - Number.parseFloat(paddingBottom);

      if ((vertical && containerHeight <= 0) || (!vertical && containerWidth <= 0)) {
        return;
      }

      const mouseStartX = e.xStart;
      const mouseStartY = e.yStart;
      const startWidth = containerWidth * renderedWidth;
      const startHeight = containerHeight * renderedHeight;

      if (vertical) {
        const minHeight = Math.min(minHeightPx, containerHeight);
        const maxHeightPx = Math.max(minHeight, containerHeight - minHeightPx);
        const newHeightPx = clamp(startHeight - (e.y - mouseStartY), minHeight, maxHeightPx);
        setHeight(newHeightPx / containerHeight);
      } else {
        const minWidth = Math.min(minWidthPx, containerWidth);
        const maxWidthPx = Math.max(minWidth, containerWidth - minWidthPx);
        const newWidthPx = clamp(startWidth - (e.x - mouseStartX), minWidth, maxWidthPx);
        setWidth(newWidthPx / containerWidth);
      }
    },
    [
      renderedWidth,
      renderedHeight,
      vertical,
      minHeightPx,
      setHeight,
      minWidthPx,
      setWidth,
    ],
  );

  return (
    <div
      ref={containerRef}
      style={styles}
      className={classNames(className, "grid w-full h-full overflow-hidden")}
    >
      {firstSlot({ style: areaL, orientation: vertical ? "vertical" : "horizontal" })}
      {secondSlot && (
        <>
          <ResizeHandle
            style={areaD}
            className={classNames(
              resizeHandleClassName,
              vertical ? "-translate-y-1" : "-translate-x-1",
            )}
            onResizeMove={handleResizeMove}
            onReset={handleReset}
            side={vertical ? "top" : "left"}
            justify="center"
          />
          {secondSlot({ style: areaR, orientation: vertical ? "vertical" : "horizontal" })}
        </>
      )}
    </div>
  );
}

function clampSplitRatio(ratio: number, minPx: number, containerPx: number): number {
  if (containerPx <= 0 || minPx <= 0) {
    return ratio;
  }

  const minRatio = Math.min(1, minPx / containerPx);
  const maxRatio = minRatio >= 0.5 ? minRatio : 1 - minRatio;
  return clamp(ratio, minRatio, maxRatio);
}
