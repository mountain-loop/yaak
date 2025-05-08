import classNames from 'classnames';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import React, { useRef, useState } from 'react';
import { generateId } from '../../lib/generateId';
import { Portal } from '../Portal';

export interface TooltipProps {
  children: ReactNode;
  content: ReactNode;
  tabIndex?: number,
  size?: 'md' | 'lg';
}

const hiddenStyles: CSSProperties = {
  left: -99999,
  top: -99999,
  visibility: 'hidden',
  pointerEvents: 'none',
  opacity: 0,
};

export function Tooltip({ children, content, tabIndex, size = 'md' }: TooltipProps) {
  const [isOpen, setIsOpen] = useState<CSSProperties>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const showTimeout = useRef<NodeJS.Timeout>();

  const handleOpenImmediate = () => {
    if (triggerRef.current == null || tooltipRef.current == null) return;
    clearTimeout(showTimeout.current);
    setIsOpen(undefined);
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const docRect = document.documentElement.getBoundingClientRect();
    const styles: CSSProperties = {
      bottom: docRect.height - triggerRect.top,
      left: Math.max(0, triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2),
      maxHeight: triggerRect.top,
    };
    setIsOpen(styles);
  };

  const handleOpen = () => {
    clearTimeout(showTimeout.current);
    showTimeout.current = setTimeout(handleOpenImmediate, 500);
  };

  const handleClose = () => {
    clearTimeout(showTimeout.current);
    setIsOpen(undefined);
  };

  const handleToggleImmediate = () => {
    if (isOpen) handleClose();
    else handleOpenImmediate();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (isOpen && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      handleClose();
    }
  };

  const id = useRef(`tooltip-${generateId()}`);

  return (
    <>
      <Portal name="tooltip">
        <div
          ref={tooltipRef}
          style={isOpen ?? hiddenStyles}
          id={id.current}
          role="tooltip"
          aria-hidden={!isOpen}
          onMouseEnter={handleOpenImmediate}
          onMouseLeave={handleClose}
          className="p-2 fixed z-50 text-sm transition-opacity grid grid-rows-[minmax(0,1fr)]"
        >
          <div
            className={classNames(
              'bg-surface-highlight rounded-md px-3 py-2 z-50 border border-border overflow-auto',
              size === 'md' && 'max-w-sm',
              size === 'lg' && 'max-w-md',
            )}
          >
            {content}
          </div>
          <Triangle className="text-border mb-2" />
        </div>
      </Portal>
      <span
        ref={triggerRef}
        role="button"
        aria-describedby={isOpen ? id.current : undefined}
        tabIndex={tabIndex ?? 0}
        className="flex-grow-0 flex items-center"
        onClick={handleToggleImmediate}
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
        onFocus={handleOpenImmediate}
        onBlur={handleClose}
        onKeyDown={handleKeyDown}
      >
        {children}
      </span>
    </>
  );
}

function Triangle({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 30 10"
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      className={classNames(
        className,
        'absolute z-50 border-t-[2px] border-surface-highlight',
        '-bottom-[calc(0.5rem-3px)] left-[calc(50%-0.4rem)]',
        'h-[0.5rem] w-[0.8rem]',
      )}
    >
      <polygon className="fill-surface-highlight" points="0,0 30,0 15,10" />
      <path
        d="M0 0 L15 9 L30 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="miter"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
