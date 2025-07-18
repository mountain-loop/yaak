import classNames from 'classnames';
import type { ReactNode } from 'react';

export interface BannerProps {
  children: ReactNode;
  className?: string;
  color?: 'primary' | 'secondary' | 'success' | 'notice' | 'warning' | 'danger' | 'info';
}

export function Banner({ children, className, color }: BannerProps) {
  return (
    <div className="w-full mb-auto grid grid-rows-1 max-h-full">
      <div
        className={classNames(
          className,
          color && 'bg-surface',
          `x-theme-banner--${color}`,
          'border border-border border-dashed',
          'px-4 py-2 rounded-lg select-auto',
          'overflow-auto text-text',
        )}
      >
        {children}
      </div>
    </div>
  );
}
