import classNames from "classnames";
import * as m from "motion/react-m";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useContainerSize } from "../hooks/useContainerSize";
import { Overlay } from "./Overlay";
import type { ResizeHandleEvent } from "./ResizeHandle";
import { ResizeHandle } from "./ResizeHandle";
import type { SidebarDrag, SidebarSize } from "./resizeDrag";
import { createSidebarDrag, sidebarGridTemplate } from "./resizeDrag";

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

  // While dragging, the width is written straight to the DOM and only handed to the owner when the
  // drag ends. Until the owner's props catch up with that (hiding may be saved asynchronously),
  // keep showing what the drag ended on, so the sidebar does not flash back open.
  const liveDrag = useRef<SidebarDrag | null>(null);
  const [committed, setCommitted] = useState<{ from: SidebarSize; to: SidebarSize } | null>(null);

  if (committed != null) {
    const { from, to } = committed;
    const settled = (prop: number | boolean, key: keyof SidebarSize) =>
      prop === to[key] || prop !== from[key];
    if (settled(hidden, "hidden") && settled(width, "width")) setCommitted(null);
  }

  const shownWidth = committed?.to.width ?? width;
  const shownHidden = committed?.to.hidden ?? hidden;
  const sideWidth = shownHidden ? 0 : shownWidth;

  const styles = useMemo<CSSProperties>(
    () => ({ gridTemplate: sidebarGridTemplate(sideWidth) }),
    [sideWidth],
  );

  const applySize = useCallback((size: SidebarSize) => {
    if (containerRef.current == null) return;
    containerRef.current.style.gridTemplate = sidebarGridTemplate(size.hidden ? 0 : size.width);
  }, []);

  // Something else re-rendering mid-drag may write the saved width back; put the live one back
  // before it is painted.
  useLayoutEffect(() => {
    const size = liveDrag.current?.size;
    if (size != null) applySize(size);
  });

  const handleResizeStart = useCallback(() => {
    const from = { width: shownWidth, hidden: shownHidden };
    liveDrag.current = createSidebarDrag({
      startWidth: shownWidth,
      minWidth,
      defaultWidth,
      apply: applySize,
      commit: (to) => {
        setCommitted({ from, to });
        if (to.hidden !== from.hidden) onHiddenChange?.(to.hidden);
        onWidthChange(to.width);
      },
    });
    setIsResizing(true);
  }, [shownWidth, shownHidden, minWidth, defaultWidth, applySize, onHiddenChange, onWidthChange]);

  const handleResizeMove = useCallback((e: ResizeHandleEvent) => liveDrag.current?.move(e), []);

  const handleResizeEnd = useCallback(() => {
    const d = liveDrag.current;
    liveDrag.current = null;
    d?.end();
    setIsResizing(false);
  }, []);

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
        className="-translate-x-px"
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
