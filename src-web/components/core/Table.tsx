import classNames from 'classnames';
import type { ReactNode } from 'react';
import React from 'react';

export function Table({ children }: { children: ReactNode }) {
  return (
    <table className="w-full text-sm mb-auto min-w-full max-w-full divide-y divide-surface-highlight">
      {children}
    </table>
  );
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-surface-highlight">{children}</tbody>;
}

export function TableHead({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>;
}

export function TableRow({ children }: { children: ReactNode }) {
  return <tr>{children}</tr>;
}

export function TableCell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <td
      className={classNames(
        className,
        'py-2 [&:not(:first-child)]:pl-4 text-left whitespace-nowrap',
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
    <TableCell className={classNames(className, 'w-full relative')}>
      <div className="absolute inset-0 py-2 truncate">{children}</div>
    </TableCell>
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
    <th className={classNames(className, 'py-2 [&:not(:first-child)]:pl-4 text-left text-text-subtle')}>
      {children}
    </th>
  );
}
