import type { Color } from '@yaakapp-internal/plugins';
import classNames from 'classnames';
import type { ReactNode } from 'react';

interface Props {
  orientation?: 'horizontal' | 'vertical';
  dashed?: boolean;
  className?: string;
  children?: ReactNode;
  color?: Color;
}

export function Separator({ color, className, dashed, orientation = 'horizontal', children }: Props) {
  return (
    <div role="separator" className={classNames(className, 'flex items-center w-full')}>
      {children && (
        <div className="text-sm text-text-subtlest mr-2 whitespace-nowrap">{children}</div>
      )}
      <div
        className={classNames(
          'h-0 border-t opacity-60',
          color == null && 'border-border',
          color === 'primary' && 'border-primary',
          color === 'secondary' && 'border-secondary',
          color === 'success' && 'border-success',
          color === 'notice' && 'border-notice',
          color === 'warning' && 'border-warning',
          color === 'danger' && 'border-danger',
          color === 'info' && 'border-info',
          dashed && 'border-dashed',
          orientation === 'horizontal' && 'w-full h-[1px]',
          orientation === 'vertical' && 'h-full w-[1px]',
        )}
      />
    </div>
  );
}
