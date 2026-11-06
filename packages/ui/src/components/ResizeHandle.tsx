import classNames from "classnames";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createHandleDrag } from "./resizeDrag";

export interface ResizeHandleEvent {
  x: number;
  y: number;
  xStart: number;
  yStart: number;
}

interface Props {
  style?: CSSProperties;
  className?: string;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
  onResizeMove?: (e: ResizeHandleEvent) => void;
  onReset?: () => void;
  side: "left" | "right" | "top";
  justify: "center" | "end" | "start";
}

export function ResizeHandle({
  style,
  justify,
  className,
  onResizeStart,
  onResizeEnd,
  onResizeMove,
  onReset,
  side,
}: Props) {
  const vertical = side === "top";
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const stopDrag = useRef<(() => void) | null>(null);

  // A handle that goes away mid-drag ends the drag, so its owner is not left resizing
  useEffect(() => () => stopDrag.current?.(), []);

  const handlePointerDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      stopDrag.current?.();

      const drag = createHandleDrag({
        vertical,
        xStart: e.clientX,
        yStart: e.clientY,
        onResizeStart: () => {
          onResizeStart?.();
          setIsResizing(true);
        },
        onResizeMove,
        onResizeEnd,
      });

      function move(e: MouseEvent) {
        drag.move(e);
      }

      function removeListeners() {
        stopDrag.current = null;
        document.documentElement.removeEventListener("mousemove", move);
        document.documentElement.removeEventListener("mouseup", up);
      }

      function up() {
        removeListeners();
        setIsResizing(false);
        drag.up();
      }

      stopDrag.current = () => {
        removeListeners();
        drag.abort();
      };

      document.documentElement.addEventListener("mousemove", move);
      document.documentElement.addEventListener("mouseup", up);
    },
    [onResizeEnd, onResizeMove, onResizeStart, vertical],
  );

  return (
    <div
      aria-hidden
      style={style}
      onDoubleClick={onReset}
      onPointerDown={handlePointerDown}
      className={classNames(
        className,
        "group z-10 flex select-none transition-colors hover:bg-surface-active rounded-full",
        vertical ? "w-full h-1.5 cursor-row-resize" : "h-full w-1.5 cursor-col-resize",
        justify === "center" && "justify-center",
        justify === "end" && "justify-end",
        justify === "start" && "justify-start",
        side === "right" && "right-0",
        side === "left" && "left-0",
        side === "top" && "top-0",
      )}
    >
      {isResizing && (
        <div
          className={classNames(
            "fixed left-[-100vw] right-[-100vw] top-[-100vh] bottom-[-100vh]",
            vertical && "cursor-row-resize",
            !vertical && "cursor-col-resize",
          )}
        />
      )}
    </div>
  );
}
