import classNames from 'classnames';
import type { ReactNode } from 'react';

interface Props {
  orientation?: 'horizontal' | 'vertical';
  dashed?: boolean;
  className?: string;
  children?: ReactNode;
}

export function Separator({ className, dashed, orientation = 'horizontal', children }: Props) {
  return (
    <div role="separator" className={classNames(className, 'flex items-center w-full')}>
      {children && (
        <div className="text-sm text-text-subtlest mr-2 whitespace-nowrap">{children}</div>
      )}
      <div
        className={classNames(
          'h-0 border-t border-t-border-subtle',
          dashed && 'border-dashed',
          orientation === 'horizontal' && 'w-full h-[1px]',
          orientation === 'vertical' && 'h-full w-[1px]',
        )}
      />
    </div>
  );
}
