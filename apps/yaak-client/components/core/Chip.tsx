import type { Color } from "@yaakapp-internal/plugins";
import classNames from "classnames";
import type { ReactNode } from "react";

interface Props {
  color?: Color | "default";
  className?: string;
  children: ReactNode;
}

/** A small tinted label, like a Gmail or Trello label */
export function Chip({ color = "default", className, children }: Props) {
  return (
    <span
      className={classNames(
        className,
        "text-xs font-medium rounded-md px-2 py-0.5 bg-current/10 border border-current/10 shrink-0 whitespace-nowrap",
        "inline-flex items-center gap-1",
        color === "default" && "text-text-subtle",
        color === "primary" && "text-primary",
        color === "secondary" && "text-secondary",
        color === "info" && "text-info",
        color === "success" && "text-success",
        color === "notice" && "text-notice",
        color === "warning" && "text-warning",
        color === "danger" && "text-danger",
      )}
    >
      {children}
    </span>
  );
}
