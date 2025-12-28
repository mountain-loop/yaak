import classNames from 'classnames';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
}

export function FormattedError({ children, className }: Props) {
  return (
    <pre
      className={classNames(
        className,
        'cursor-text select-auto',
        '[&_*]:cursor-text [&_*]:select-auto',
        'font-mono text-sm w-full bg-surface-highlight p-3 rounded',
        'whitespace-pre-wrap border border-danger border-dashed overflow-x-auto',
      )}
    >
      {children}
    </pre>
  );
}
