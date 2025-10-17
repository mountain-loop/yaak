import classNames from 'classnames';
import type { CSSProperties} from 'react';
import React, { memo } from 'react';

interface Props {
  className?: string;
  style?: CSSProperties;
}

export const DropMarker = memo(
  function DropMarker({ className, style }: Props) {
    return (
      <div
        style={style}
        className={classNames(
          className,
          'relative w-full h-0 overflow-visible pointer-events-none',
        )}
      >
        <div className="absolute z-50 left-2 right-2 -bottom-[0.1rem] h-[0.2rem] bg-primary rounded-full" />
      </div>
    );
  },
  () => true,
);
