import classNames from 'classnames';
import type { HTMLAttributes, ReactNode } from 'react';
import { IconTooltip } from './IconTooltip';

export function Label({
  htmlFor,
  className,
  children,
  visuallyHidden,
  tags = [],
  required,
  help,
  ...props
}: HTMLAttributes<HTMLLabelElement> & {
  htmlFor: string | null;
  required?: boolean;
  tags?: string[];
  visuallyHidden?: boolean;
  children: ReactNode;
  help?: ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor ?? undefined}
      className={classNames(
        className,
        visuallyHidden && 'sr-only',
        'flex-shrink-0 text-sm',
        'text-text-subtle whitespace-nowrap flex items-center gap-1 mb-0.5',
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
      {help && <IconTooltip tabIndex={-1} content={help} />}
    </label>
  );
}
