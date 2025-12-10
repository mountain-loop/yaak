import type { Color } from '@yaakapp-internal/plugins';
import classNames from 'classnames';

interface Props {
  count: number | true;
  className?: string;
  color?: Color;
}

export function CountBadge({ count, className, color }: Props) {
  if (count === 0) return null;
  return (
    <div
      aria-hidden
      className={classNames(
        className,
        'flex items-center',
        'opacity-70 border text-4xs rounded mb-0.5 px-1 ml-1 h-4 font-mono',
        color == null && 'border-border-subtle',
        color === 'primary' && 'text-primary',
        color === 'secondary' && 'text-primary',
        color === 'success' && 'text-primary',
        color === 'notice' && 'text-notice',
        color === 'warning' && 'text-warning',
        color === 'danger' && 'text-danger',
      )}
    >
      {count === true ? (
        <div aria-hidden className="rounded-full h-1 w-1 bg-[currentColor]" />
      ) : (
        count
      )}
    </div>
  );
}
