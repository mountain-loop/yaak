import classNames from 'classnames';
import type { HTMLAttributes } from 'react';

export function Label({
  htmlFor,
  className,
  children,
  visuallyHidden,
  tags = [],
  required,
  ...props
}: HTMLAttributes<HTMLLabelElement> & {
  htmlFor: string;
  required?: boolean;
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
      <span>
        {children}
        {required === true && <span className="text-text-subtlest">*</span>}
      </span>
      {tags.map((tag, i) => (
        <span key={i} className="text-xs text-text-subtlest">
          ({tag})
        </span>
      ))}
    </label>
  );
}
