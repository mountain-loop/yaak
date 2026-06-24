import classNames from "classnames";
import type { HTMLAttributes } from "react";
import type { ReactNode } from "react";

export function Table({
  children,
  className,
  scrollable,
  style,
}: {
  children: ReactNode;
  className?: string;
  scrollable?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div style={style} className={classNames("w-full", scrollable && "h-full overflow-y-auto")}>
      <table
        className={classNames(
          className,
          "w-full text-sm mb-auto min-w-full max-w-full",
          "border-separate border-spacing-0",
          scrollable && "[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10",
        )}
      >
        {children}
      </table>
    </div>
  );
}

export function TableBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <tbody
      className={classNames(
        className,
        "[&>tr:not(:last-child):not([data-table-spacer])>td]:border-b",
        "[&>tr:not(:last-child):not([data-table-spacer])>td]:border-b-surface-highlight",
      )}
    >
      <tr aria-hidden data-table-spacer className="h-0.5">
        <td className="p-0" colSpan={1000} />
      </tr>
      {children}
    </tbody>
  );
}

export function TableHead({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <thead
      className={classNames(
        className,
        "bg-surface [&_th]:border-b [&_th]:border-b-surface-highlight",
      )}
    >
      {children}
    </thead>
  );
}

export function TableRow({
  children,
  className,
  ...props
}: {
  children: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={className} {...props}>
      {children}
    </tr>
  );
}

export function TableCell({
  children,
  className,
  align = "left",
}: {
  children: ReactNode;
  className?: string;
  align?: "left" | "center" | "right";
}) {
  return (
    <td
      className={classNames(
        className,
        "py-2 [&:not(:first-child)]:pl-4 whitespace-nowrap",
        align === "left" ? "text-left" : align === "center" ? "text-center" : "text-right",
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
    <TableCell className={classNames(className, "truncate max-w-0 w-full")}>{children}</TableCell>
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
        "whitespace-nowrap py-2 [&:not(:first-child)]:pl-4 text-left text-text-subtle",
      )}
    >
      {children}
    </th>
  );
}
