import classNames from 'classnames';
import * as m from 'motion/react-m';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { Overlay } from '../Overlay';
import { Heading } from './Heading';
import { IconButton } from './IconButton';

export interface DialogProps {
  children: ReactNode;
  open: boolean;
  onClose?: () => void;
  disableBackdropClose?: boolean;
  title?: ReactNode;
  description?: ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'full' | 'dynamic';
  hideX?: boolean;
  noPadding?: boolean;
  noScroll?: boolean;
  vAlign?: 'top' | 'center';
}

export function Dialog({
  children,
  className,
  size = 'full',
  open,
  onClose,
  disableBackdropClose,
  title,
  description,
  hideX,
  noPadding,
  noScroll,
  vAlign = 'center',
}: DialogProps) {
  const titleId = useMemo(() => Math.random().toString(36).slice(2), []);
  const descriptionId = useMemo(
    () => (description ? Math.random().toString(36).slice(2) : undefined),
    [description],
  );

  return (
    <Overlay open={open} onClose={disableBackdropClose ? undefined : onClose} portalName="dialog">
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        role="dialog"
        className={classNames(
          'py-4 x-theme-dialog absolute inset-0 pointer-events-none',
          'h-full flex flex-col items-center justify-center',
          vAlign === 'top' && 'justify-start',
          vAlign === 'center' && 'justify-center',
        )}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onKeyDown={(e) => {
          // NOTE: We handle Escape on the element itself so that it doesn't close multiple
          //   dialogs and can be intercepted by children if needed.
          if (e.key === 'Escape') {
            onClose?.();
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        <m.div
          initial={{ top: 5, scale: 0.97 }}
          animate={{ top: 0, scale: 1 }}
          className={classNames(
            className,
            'grid grid-rows-[auto_auto_minmax(0,1fr)]',
            'grid-cols-1', // must be here for inline code blocks to correctly break words
            'relative bg-surface pointer-events-auto',
            'rounded-lg',
            'border border-border-subtle shadow-lg shadow-[rgba(0,0,0,0.1)]',
            'min-h-[10rem]',
            'max-w-[calc(100vw-5rem)] max-h-[calc(100vh-5rem)]',
            size === 'sm' && 'w-[30rem]',
            size === 'md' && 'w-[50rem]',
            size === 'lg' && 'w-[70rem]',
            size === 'full' && 'w-[100vw] h-[100vh]',
            size === 'dynamic' && 'min-w-[20rem] max-w-[100vw]',
          )}
        >
          {title ? (
            <Heading className="px-6 mt-4 mb-2" level={1} id={titleId}>
              {title}
            </Heading>
          ) : (
            <span aria-hidden />
          )}

          {description ? (
            <div className="px-6 text-text-subtle mb-3" id={descriptionId}>
              {description}
            </div>
          ) : (
            <span aria-hidden />
          )}

          <div
            className={classNames(
              'h-full w-full grid grid-cols-[minmax(0,1fr)] grid-rows-1',
              !noPadding && 'px-6 py-2',
              !noScroll && 'overflow-y-auto overflow-x-hidden',
            )}
          >
            {children}
          </div>

          {/*Put close at the end so that it's the last thing to be tabbed to*/}
          {!hideX && (
            <div className="ml-auto absolute right-1 top-1">
              <IconButton
                className="opacity-70 hover:opacity-100"
                onClick={onClose}
                title="Close dialog (Esc)"
                aria-label="Close"
                size="sm"
                icon="x"
              />
            </div>
          )}
        </m.div>
      </div>
    </Overlay>
  );
}
