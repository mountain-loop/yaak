import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import type { CSSProperties, ReactNode } from 'react';
import React, { useCallback, useMemo, useRef } from 'react';
import { useLocalStorage } from 'react-use';
import { activeWorkspaceAtom } from '../../hooks/useActiveWorkspace';
import { useContainerSize } from '../../hooks/useContainerQuery';
import { clamp } from '../../lib/clamp';
import type { ResizeHandleEvent } from '../ResizeHandle';
import { ResizeHandle } from '../ResizeHandle';

export type SplitLayoutLayout = 'responsive' | 'horizontal' | 'vertical';

export interface SlotProps {
  orientation: 'horizontal' | 'vertical';
  style: CSSProperties;
}

interface Props {
  name: string;
  firstSlot: (props: SlotProps) => ReactNode;
  secondSlot: null | ((props: SlotProps) => ReactNode);
  style?: CSSProperties;
  className?: string;
  defaultRatio?: number;
  minHeightPx?: number;
  minWidthPx?: number;
  layout?: SplitLayoutLayout;
}

const baseProperties = { minWidth: 0 };
const areaL = { ...baseProperties, gridArea: 'left' };
const areaR = { ...baseProperties, gridArea: 'right' };
const areaD = { ...baseProperties, gridArea: 'drag' };

const STACK_VERTICAL_WIDTH = 500;

export function SplitLayout({
  style,
  firstSlot,
  secondSlot,
  className,
  name,
  layout = 'responsive',
  defaultRatio = 0.5,
  minHeightPx = 10,
  minWidthPx = 10,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeWorkspace = useAtomValue(activeWorkspaceAtom);
  const [widthRaw, setWidth] = useLocalStorage<number>(
    `${name}_width::${activeWorkspace?.id ?? 'n/a'}`,
  );
  const [heightRaw, setHeight] = useLocalStorage<number>(
    `${name}_height::${activeWorkspace?.id ?? 'n/a'}`,
  );
  const width = widthRaw ?? defaultRatio;
  let height = heightRaw ?? defaultRatio;

  if (!secondSlot) {
    height = 0;
    minHeightPx = 0;
  }

  const size = useContainerSize(containerRef);
  const verticalBasedOnSize = size.width !== 0 && size.width < STACK_VERTICAL_WIDTH;
  const vertical = layout !== 'horizontal' && (layout === 'vertical' || verticalBasedOnSize);

  const styles = useMemo<CSSProperties>(() => {
    return {
      ...style,
      gridTemplate: vertical
        ? `
            ' ${areaL.gridArea}' minmax(0,${1 - height}fr)
            ' ${areaD.gridArea}' 0
            ' ${areaR.gridArea}' minmax(${minHeightPx}px,${height}fr)
            / 1fr            
          `
        : `
            ' ${areaL.gridArea} ${areaD.gridArea} ${areaR.gridArea}' minmax(0,1fr)
            / ${1 - width}fr    0                 ${width}fr           
          `,
    };
  }, [style, vertical, height, minHeightPx, width]);

  const handleReset = useCallback(() => {
    if (vertical) setHeight(defaultRatio);
    else setWidth(defaultRatio);
  }, [vertical, setHeight, defaultRatio, setWidth]);

  const handleResizeMove = useCallback(
    (e: ResizeHandleEvent) => {
      if (containerRef.current === null) return;

      // const containerRect = containerRef.current.getBoundingClientRect();
      const { paddingLeft, paddingRight, paddingTop, paddingBottom } = getComputedStyle(
        containerRef.current,
      );
      const $c = containerRef.current;
      const containerWidth = $c.clientWidth - parseFloat(paddingLeft) - parseFloat(paddingRight);
      const containerHeight = $c.clientHeight - parseFloat(paddingTop) - parseFloat(paddingBottom);

      const mouseStartX = e.xStart;
      const mouseStartY = e.yStart;
      const startWidth = containerWidth * width;
      const startHeight = containerHeight * height;

      if (vertical) {
        const maxHeightPx = containerHeight - minHeightPx;
        const newHeightPx = clamp(startHeight - (e.y - mouseStartY), minHeightPx, maxHeightPx);
        setHeight(newHeightPx / containerHeight);
      } else {
        const maxWidthPx = containerWidth - minWidthPx;
        const newWidthPx = clamp(startWidth - (e.x - mouseStartX), minWidthPx, maxWidthPx);
        setWidth(newWidthPx / containerWidth);
      }
    },
    [width, height, vertical, minHeightPx, setHeight, minWidthPx, setWidth],
  );

  return (
    <div
      ref={containerRef}
      style={styles}
      className={classNames(className, 'grid w-full h-full overflow-hidden')}
    >
      {firstSlot({ style: areaL, orientation: vertical ? 'vertical' : 'horizontal' })}
      {secondSlot && (
        <>
          <ResizeHandle
            style={areaD}
            className={classNames(vertical ? '-translate-y-1' : '-translate-x-1')}
            onResizeMove={handleResizeMove}
            onReset={handleReset}
            side={vertical ? 'top' : 'left'}
            justify="center"
          />
          {secondSlot({ style: areaR, orientation: vertical ? 'vertical' : 'horizontal' })}
        </>
      )}
    </div>
  );
}
