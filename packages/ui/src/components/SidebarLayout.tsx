import classNames from 'classnames';
import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ResizeHandleEvent } from './ResizeHandle';
import { ResizeHandle } from './ResizeHandle';

const side = { gridArea: 'side', minWidth: 0 };
const drag = { gridArea: 'drag' };
const body = { gridArea: 'body', minWidth: 0 };

interface Props {
  width: number;
  onWidthChange: (width: number) => void;
  hidden?: boolean;
  onHiddenChange?: (hidden: boolean) => void;
  floating?: boolean;
  floatingWidth?: number;
  defaultWidth?: number;
  minWidth?: number;
  className?: string;
  sidebar: ReactNode;
  children: ReactNode;
}

export function SidebarLayout({
  width,
  onWidthChange,
  hidden = false,
  onHiddenChange,
  floating = false,
  floatingWidth = 320,
  defaultWidth = 250,
  minWidth = 50,
  className,
  sidebar,
  children,
}: Props) {
  const [isResizing, setIsResizing] = useState(false);
  const startWidth = useRef<number | null>(null);

  const sideWidth = hidden ? 0 : width;

  const styles = useMemo<CSSProperties>(
    () => ({
      gridTemplate: `
        ' ${side.gridArea} ${drag.gridArea} ${body.gridArea}' minmax(0,1fr)
        / ${sideWidth}px   0                1fr`,
    }),
    [sideWidth],
  );

  const handleResizeStart = useCallback(() => {
    startWidth.current = width;
    setIsResizing(true);
  }, [width]);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    startWidth.current = null;
  }, []);

  const handleResizeMove = useCallback(
    ({ x, xStart }: ResizeHandleEvent) => {
      if (startWidth.current == null) return;

      const newWidth = startWidth.current + (x - xStart);
      if (newWidth < minWidth) {
        onHiddenChange?.(true);
        onWidthChange(defaultWidth);
      } else {
        if (hidden) onHiddenChange?.(false);
        onWidthChange(newWidth);
      }
    },
    [minWidth, hidden, onHiddenChange, onWidthChange, defaultWidth],
  );

  const handleReset = useCallback(() => {
    onWidthChange(defaultWidth);
  }, [onWidthChange, defaultWidth]);

  if (floating) {
    return (
      <div className={classNames(className, 'relative w-full h-full overflow-hidden')}>
        {children}
        {!hidden && (
          <>
            <div
              className="absolute inset-0 bg-black/50 z-20 transition-opacity"
              onClick={() => onHiddenChange?.(true)}
            />
            <div
              style={{ width: floatingWidth }}
              className="absolute top-0 left-0 bottom-0 z-20 animate-slide-in-left"
            >
              {sidebar}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      style={styles}
      className={classNames(
        className,
        'grid w-full h-full',
        !isResizing && 'transition-grid',
      )}
    >
      <div style={side} className="overflow-hidden">
        {sidebar}
      </div>
      <ResizeHandle
        style={drag}
        className="-translate-x-[1px]"
        justify="end"
        side="right"
        onResizeStart={handleResizeStart}
        onResizeEnd={handleResizeEnd}
        onResizeMove={handleResizeMove}
        onReset={handleReset}
      />
      <div style={body} className="min-w-0">
        {children}
      </div>
    </div>
  );
}
