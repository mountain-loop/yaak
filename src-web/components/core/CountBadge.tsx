import classNames from 'classnames';

interface Props {
  count: number | true;
  className?: string;
}

export function CountBadge({ count, className }: Props) {
  if (count === 0) return null;
  return (
    <div
      aria-hidden
      className={classNames(
        className,
        'opacity-70 border border-border-subtle text-4xs rounded mb-0.5 px-1 ml-1 h-4 font-mono',
      )}
    >
      {count === true ? '⊙' : count}
    </div>
  );
}
