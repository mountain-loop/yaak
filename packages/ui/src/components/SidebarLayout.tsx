import classNames from "classnames";
import * as m from "motion/react-m";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useContainerSize } from "../hooks/useContainerSize";
import { Overlay } from "./Overlay";
import type { ResizeHandleEvent } from "./ResizeHandle";
import { ResizeHandle } from "./ResizeHandle";

const FLOATING_BREAKPOINT = 600;

const side = { gridArea: "side", minWidth: 0 };
const drag = { gridArea: "drag" };
const body = { gridArea: "body", minWidth: 0 };

interface Props {
  width: number;
  onWidthChange: (width: number) => void;
  hidden?: boolean;
  onHiddenChange?: (hidden: boolean) => void;
  floatingHidden?: boolean;
  onFloatingHiddenChange?: (hidden: boolean) => void;
  onFloatingChange?: (floating: boolean) => void;
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
  floatingHidden = true,
  onFloatingHiddenChange,
  onFloatingChange,
  floatingWidth = 320,
  defaultWidth = 250,
  minWidth = 50,
  className,
  sidebar,
  children,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const containerSize = useContainerSize(containerRef);
  const floating = containerSize.width > 0 && containerSize.width <= FLOATING_BREAKPOINT;

  useEffect(() => {
    onFloatingChange?.(floating);
  }, [floating]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <div ref={containerRef} className={classNames(className, "w-full h-full min-h-0")}>
        <Overlay
          open={!floatingHidden}
          portalName="sidebar"
          onClose={() => onFloatingHiddenChange?.(true)}
          zIndex={20}
        >
          <m.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            style={{ width: floatingWidth }}
            className="absolute top-0 left-0 bottom-0"
          >
            {sidebar}
          </m.div>
        </Overlay>
        {children}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={styles}
      className={classNames(className, "grid w-full h-full", !isResizing && "transition-grid")}
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
