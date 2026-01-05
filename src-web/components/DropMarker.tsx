import classNames from 'classnames';
import type { CSSProperties } from 'react';
import { memo } from 'react';

interface Props {
  className?: string;
  style?: CSSProperties;
  orientation?: 'horizontal' | 'vertical';
}

export const DropMarker = memo(
  function DropMarker({ className, style, orientation = 'horizontal' }: Props) {
    return (
      <div
        style={style}
        className={classNames(
          className,
          'absolute pointer-events-none z-50',
          orientation === 'horizontal' && 'w-full',
          orientation === 'vertical' && 'w-0 top-0 bottom-0',
        )}
      >
        <div
          className={classNames(
            'absolute bg-primary rounded-full',
            orientation === 'horizontal' && 'left-2 right-2 -bottom-[0.1rem] h-[0.2rem]',
            orientation === 'vertical' && '-left-[0.1rem] top-0 bottom-0 w-[0.2rem]',
          )}
        />
      </div>
    );
  },
  () => true,
);
