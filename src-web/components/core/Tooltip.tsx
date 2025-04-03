import classNames from 'classnames';
import type { CSSProperties, ReactNode, KeyboardEvent } from 'react';
import React, { useRef, useState } from 'react';
import { generateId } from '../../lib/generateId';
import { Portal } from '../Portal';
import { Icon } from './Icon';

interface Props {
  children?: ReactNode;
  content: ReactNode;
}

const hiddenStyles: CSSProperties = {
  left: -99999,
  top: -99999,
  visibility: 'hidden',
  pointerEvents: 'none',
  opacity: 0,
};

export function Tooltip({ children, content }: Props) {
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
          className="p-2 fixed z-50 text-sm transition-opacity"
        >
          <div className="bg-surface-highlight rounded-md px-3 py-2 z-50 border border-border relative max-w-xs">
            <Triangle />
            {content}
          </div>
        </div>
      </Portal>
      <button
        ref={triggerRef}
        aria-describedby={isOpen ? id.current : undefined}
        className="flex-grow-0 inline-flex items-center"
        onClick={handleToggleImmediate}
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
        onFocus={handleOpenImmediate}
        onBlur={handleClose}
        onKeyDown={handleKeyDown}
      >
        {children ?? <Icon icon="info" className="opacity-60 hover:opacity-100" />}
      </button>
    </>
  );
}

function Triangle() {
  return (
    <span
      aria-hidden
      className={classNames(
        'bg-surface-highlight absolute border-border border-t border-l',
        '-bottom-1 left-[calc(50%-0.2rem)]',
        'w-[0.4rem] h-[0.4rem] rotate-[225deg]',
      )}
    />
  );
}
