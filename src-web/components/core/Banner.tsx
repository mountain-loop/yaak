import classNames from 'classnames';
import type { ReactNode } from 'react';

export interface BannerProps {
  children: ReactNode;
  className?: string;
  color?: 'primary' | 'secondary' | 'success' | 'notice' | 'warning' | 'danger' | 'info';
}

export function Banner({ children, className, color }: BannerProps) {
  return (
    <div className="w-auto grid grid-rows-1 max-h-full flex-0">
      <div
        className={classNames(
          className,
          color && 'bg-surface',
          `x-theme-banner--${color}`,
          'border border-border border-dashed',
          'px-4 py-2 rounded-lg select-auto',
          'overflow-auto text-text',
          'mb-auto', // Don't stretch all the way down if the parent is in grid or flexbox
        )}
      >
        {children}
      </div>
    </div>
  );
}
