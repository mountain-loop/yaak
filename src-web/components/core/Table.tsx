import classNames from 'classnames';
import type { ReactNode } from 'react';

export function Table({
  children,
  className,
  scrollable,
}: {
  children: ReactNode;
  className?: string;
  scrollable?: boolean;
}) {
  return (
    <div className={classNames('w-full', scrollable && 'h-full overflow-y-auto')}>
      <table
        className={classNames(
          className,
          'w-full text-sm mb-auto min-w-full max-w-full',
          'border-separate border-spacing-0',
          scrollable && '[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10',
        )}
      >
        {children}
      </table>
    </div>
  );
}

export function TableBody({ children }: { children: ReactNode }) {
  return (
    <tbody className="[&>tr:not(:last-child)>td]:border-b [&>tr:not(:last-child)>td]:border-b-surface-highlight">
      {children}
    </tbody>
  );
}

export function TableHead({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <thead
      className={classNames(
        className,
        'bg-surface [&_th]:border-b [&_th]:border-b-surface-highlight',
      )}
    >
      {children}
    </thead>
  );
}

export function TableRow({ children }: { children: ReactNode }) {
  return <tr>{children}</tr>;
}

export function TableCell({
  children,
  className,
  align = 'left',
}: {
  children: ReactNode;
  className?: string;
  align?: 'left' | 'center' | 'right';
}) {
  return (
    <td
      className={classNames(
        className,
        'py-2 [&:not(:first-child)]:pl-4 whitespace-nowrap',
        align === 'left' ? 'text-left' : align === 'center' ? 'text-center' : 'text-right',
      )}
    >
      {children}
    </td>
  );
}

export function TruncatedWideTableCell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <TableCell className={classNames(className, 'truncate max-w-0 w-full')}>{children}</TableCell>
  );
}

export function TableHeaderCell({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <th
      className={classNames(
        className,
        'py-2 [&:not(:first-child)]:pl-4 text-left text-text-subtle',
      )}
    >
      {children}
    </th>
  );
}
