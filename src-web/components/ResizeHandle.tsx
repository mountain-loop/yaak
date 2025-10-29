import classNames from 'classnames';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import React, { useCallback, useRef, useState } from 'react';

const START_DISTANCE = 7;

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
  side: 'left' | 'right' | 'top';
  justify: 'center' | 'end' | 'start';
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
  const vertical = side === 'top';
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const moveState = useRef<{
    move: (e: MouseEvent) => void;
    up: (e: MouseEvent) => void;
    calledStart: boolean;
    xStart: number;
    yStart: number;
  } | null>(null);

  const handlePointerDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      function move(e: MouseEvent) {
        if (moveState.current == null) return;

        const xDistance = moveState.current.xStart - e.clientX;
        const yDistance = moveState.current.yStart - e.clientY;
        const distance = Math.abs(vertical ? yDistance : xDistance);
        if (moveState.current.calledStart) {
          onResizeMove?.({
            x: e.clientX,
            y: e.clientY,
            xStart: moveState.current.xStart,
            yStart: moveState.current.yStart,
          });
        } else if (distance > START_DISTANCE) {
          onResizeStart?.();
          moveState.current.calledStart = true;
          setIsResizing(true);
        }
      }

      function up() {
        setIsResizing(false);
        moveState.current = null;
        document.documentElement.removeEventListener('mousemove', move);
        document.documentElement.removeEventListener('mouseup', up);
        onResizeEnd?.();
      }

      moveState.current = {  calledStart: false, xStart: e.clientX, yStart: e.clientY, move, up };

      document.documentElement.addEventListener('mousemove', move);
      document.documentElement.addEventListener('mouseup', up);
    },
    [moveState, onResizeEnd, onResizeMove, onResizeStart, vertical],
  );

  return (
    <div
      aria-hidden
      style={style}
      onDoubleClick={onReset}
      onPointerDown={handlePointerDown}
      className={classNames(
        className,
        'group z-10 flex select-none transition-colors hover:bg-surface-active rounded-full',
        // 'bg-info', // For debugging
        vertical ? 'w-full h-2 cursor-row-resize' : 'h-full w-2 cursor-col-resize',
        justify === 'center' && 'justify-center',
        justify === 'end' && 'justify-end',
        justify === 'start' && 'justify-start',
        side === 'right' && 'right-0',
        side === 'left' && 'left-0',
        side === 'top' && 'top-0',
      )}
    >
      {/* Show global overlay with cursor style to ensure cursor remains the same when moving quickly */}
      {isResizing && (
        <div
          className={classNames(
            // 'bg-[rgba(255,0,0,0.1)]', // For debugging
            'fixed -left-[100vw] -right-[100vw] -top-[100vh] -bottom-[100vh]',
            vertical && 'cursor-row-resize',
            !vertical && 'cursor-col-resize',
          )}
        />
      )}
    </div>
  );
}
