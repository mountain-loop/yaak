import classNames from 'classnames';
import type { HTMLAttributes } from 'react';

interface Props extends HTMLAttributes<HTMLHeadingElement> {
  level?: 1 | 2 | 3;
}

export function Heading({ className, level = 1, ...props }: Props) {
  const Component = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
  return (
    <Component
      className={classNames(
        className,
        'font-semibold text-text',
        level === 1 && 'text-2xl',
        level === 2 && 'text-xl',
        level === 3 && 'text-lg',
      )}
      {...props}
    />
  );
}
