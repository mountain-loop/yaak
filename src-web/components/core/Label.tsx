import classNames from 'classnames';
import type { HTMLAttributes } from 'react';

export function Label({
  htmlFor,
  className,
  ...props
}: HTMLAttributes<HTMLLabelElement> & { htmlFor: string }) {
  return (
    <label
      className={classNames(className, 'text-text-subtle whitespace-nowrap')}
      htmlFor={htmlFor}
      {...props}
    />
  );
}
