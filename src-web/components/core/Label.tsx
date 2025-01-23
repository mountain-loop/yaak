import classNames from 'classnames';
import type { HTMLAttributes } from 'react';

export function Label({
  htmlFor,
  className,
  children,
  visuallyHidden,
  tags = [],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  optional,
  ...props
}: HTMLAttributes<HTMLLabelElement> & {
  htmlFor: string;
  optional?: boolean;
  tags?: string[];
  visuallyHidden?: boolean;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={classNames(
        className,
        visuallyHidden && 'sr-only',
        'flex-shrink-0 text-sm',
        'text-text-subtle whitespace-nowrap flex items-center gap-1',
      )}
      {...props}
    >
      {children}
      {tags.map((tag, i) => (
        <span key={i} className="text-xs text-text-subtlest">
          ({tag})
        </span>
      ))}
    </label>
  );
}
