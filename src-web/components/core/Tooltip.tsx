import classNames from 'classnames';
import type { CSSProperties, ReactNode } from 'react';
import React, { useRef, useState } from 'react';
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
    setIsOpen(undefined);
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const docRect = document.documentElement.getBoundingClientRect();
    const styles: CSSProperties = {
      bottom: docRect.height - triggerRect.top,
      left: triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2,
    };
    setIsOpen(styles);
  };

  const handleOpen = () => {
    clearTimeout(showTimeout.current);
    showTimeout.current = setTimeout(handleOpenImmediate, 400);
  };

  const handleClose = () => {
    clearTimeout(showTimeout.current)
    setIsOpen(undefined);
  };

  return (
    <>
      <Portal name="tooltip">
        <div
          ref={tooltipRef}
          style={isOpen ?? hiddenStyles}
          aria-hidden={!isOpen}
          onMouseEnter={handleOpenImmediate}
          onMouseLeave={handleClose}
          className="pb-2 fixed z-50 text-sm"
        >
          <div className="bg-surface-highlight rounded-md px-2 py-1 z-50 border border-border relative max-w-xs">
            <Triangle />
            {content}
          </div>
        </div>
      </Portal>
      <button
        ref={triggerRef}
        className="flex-grow-0 inline-flex items-center"
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
        onFocus={handleOpen}
        onBlur={handleClose}
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
