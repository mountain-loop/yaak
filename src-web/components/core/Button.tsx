import classNames from 'classnames';
import type { HTMLAttributes, ReactNode } from 'react';
import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { HotkeyAction } from '../../hooks/useHotKey';
import { useFormattedHotkey, useHotKey } from '../../hooks/useHotKey';
import { trackEvent } from '../../lib/analytics';
import { Icon } from './Icon';

export type ButtonProps = Omit<HTMLAttributes<HTMLButtonElement>, 'color' | 'onChange'> & {
  innerClassName?: string;
  color?:
    | 'custom'
    | 'default'
    | 'secondary'
    | 'primary'
    | 'info'
    | 'success'
    | 'notice'
    | 'warning'
    | 'danger';
  variant?: 'border' | 'solid';
  isLoading?: boolean;
  size?: '2xs' | 'xs' | 'sm' | 'md';
  justify?: 'start' | 'center';
  type?: 'button' | 'submit';
  forDropdown?: boolean;
  disabled?: boolean;
  title?: string;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  hotkeyAction?: HotkeyAction;
  event?: string | { id: string; [attr: string]: number | string };
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    isLoading,
    className,
    innerClassName,
    children,
    forDropdown,
    color = 'default',
    type = 'button',
    justify = 'center',
    size = 'md',
    variant = 'solid',
    leftSlot,
    rightSlot,
    disabled,
    hotkeyAction,
    title,
    onClick,
    event,
    ...props
  }: ButtonProps,
  ref,
) {
  const hotkeyTrigger = useFormattedHotkey(hotkeyAction ?? null)?.join('');
  const fullTitle = hotkeyTrigger ? `${title ?? ''} ${hotkeyTrigger}`.trim() : title;

  const classes = classNames(
    className,
    'x-theme-button',
    `x-theme-button--${variant}`,
    `x-theme-button--${variant}--${color}`,
    'text-text',
    'border', // They all have borders to ensure the same width
    'max-w-full min-w-0', // Help with truncation
    'hocus:opacity-100', // Force opacity for certain hover effects
    'whitespace-nowrap outline-none',
    'flex-shrink-0 flex items-center',
    'focus-visible-or-class:ring',
    disabled ? 'pointer-events-none opacity-disabled' : 'pointer-events-auto',
    justify === 'start' && 'justify-start',
    justify === 'center' && 'justify-center',
    size === 'md' && 'h-md px-3 rounded-md',
    size === 'sm' && 'h-sm px-2.5 rounded-md',
    size === 'xs' && 'h-xs px-2 text-sm rounded-md',
    size === '2xs' && 'h-2xs px-2 text-xs rounded',

    // Solids
    variant === 'solid' && 'border-transparent',
    variant === 'solid' && color === 'custom' && 'ring-border-focus',
    variant === 'solid' &&
      color !== 'custom' &&
      'enabled:hocus:text-text enabled:hocus:bg-surface-highlight ring-border-subtle',
    variant === 'solid' && color !== 'custom' && color !== 'default' && 'bg-surface',

    // Borders
    variant === 'border' && 'border',
    variant === 'border' &&
      color !== 'custom' &&
      'border-border-subtle text-text-subtle enabled:hocus:border-border ' +
        'enabled:hocus:bg-surface-highlight enabled:hocus:text-text ring-border-subtler',
  );

  const buttonRef = useRef<HTMLButtonElement>(null);
  useImperativeHandle<HTMLButtonElement | null, HTMLButtonElement | null>(
    ref,
    () => buttonRef.current,
  );

  useHotKey(hotkeyAction ?? null, () => {
    buttonRef.current?.click();
  });

  return (
    <button
      ref={buttonRef}
      type={type}
      className={classes}
      disabled={disabled || isLoading}
      onClick={(e) => {
        onClick?.(e);
        if (event != null) {
          trackEvent('button', 'click', typeof event === 'string' ? { id: event } : event);
        }
      }}
      onDoubleClick={(e) => {
        // Kind of a hack? This prevents double-clicks from going through buttons. For example, when
        // double-clicking the workspace header to toggle window maximization
        e.stopPropagation();
      }}
      title={fullTitle}
      {...props}
    >
      {isLoading ? (
        <Icon icon="refresh" size={size} className="animate-spin mr-1" />
      ) : leftSlot ? (
        <div className="mr-2">{leftSlot}</div>
      ) : null}
      <div
        className={classNames(
          'truncate w-full',
          justify === 'start' ? 'text-left' : 'text-center',
          innerClassName,
        )}
      >
        {children}
      </div>
      {rightSlot && <div className="ml-1">{rightSlot}</div>}
      {forDropdown && <Icon icon="chevron_down" size={size} className="ml-1 -mr-1" />}
    </button>
  );
});
