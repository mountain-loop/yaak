import classNames from 'classnames';
import { FocusTrap } from 'focus-trap-react';
import * as m from 'motion/react-m';
import type { ReactNode } from 'react';
import React, { useRef } from 'react';
import { Portal } from './Portal';

interface Props {
  children: ReactNode;
  portalName: string;
  open: boolean;
  onClose?: () => void;
  zIndex?: keyof typeof zIndexes;
  variant?: 'default' | 'transparent';
  noBackdrop?: boolean;
}

const zIndexes: Record<number, string> = {
  10: 'z-10',
  20: 'z-20',
  30: 'z-30',
  40: 'z-40',
  50: 'z-50',
};

export function Overlay({
  variant = 'default',
  zIndex = 30,
  open,
  onClose,
  portalName,
  noBackdrop,
  children,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  if (noBackdrop) {
    return (
      <Portal name={portalName}>
        {open && (
          <FocusTrap focusTrapOptions={{ clickOutsideDeactivates: true }}>
            {/* NOTE: <div> wrapper is required for some reason, or FocusTrap complains */}
            <div>{children}</div>
          </FocusTrap>
        )}
      </Portal>
    );
  }

  return (
    <Portal name={portalName}>
      {open && (
        <FocusTrap
          focusTrapOptions={{
            allowOutsideClick: true, // So we can still click toasts and things
            delayInitialFocus: true,
            fallbackFocus: () => containerRef.current!, // always have a target
            initialFocus: () =>
              // Doing this explicitly seems to work better than the default behavior for some reason
              containerRef.current?.querySelector<HTMLElement>(
                [
                  'a[href]',
                  'input:not([disabled])',
                  'select:not([disabled])',
                  'textarea:not([disabled])',
                  'button:not([disabled])',
                  '[tabindex]:not([tabindex="-1"])',
                  '[contenteditable]:not([contenteditable="false"])',
                ].join(', '),
              ) ?? undefined,
          }}
        >
          <m.div
            ref={containerRef}
            tabIndex={-1}
            className={classNames('fixed inset-0', zIndexes[zIndex])}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <div
              aria-hidden
              onClick={onClose}
              className={classNames(
                'absolute inset-0',
                variant === 'default' && 'bg-backdrop backdrop-blur-sm',
              )}
            />

            {/* Show the draggable region at the top */}
            {/* TODO: Figure out tauri drag region and also make clickable still */}
            {variant === 'default' && (
              <div data-tauri-drag-region className="absolute top-0 left-0 h-md right-0" />
            )}
            {children}
          </m.div>
        </FocusTrap>
      )}
    </Portal>
  );
}
