import classNames from "classnames";
import type { HTMLAttributes } from "react";

export function InlineCode({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <code
      className={classNames(
        className,
        "font-mono text-shrink bg-surface-highlight border border-border-subtle grow-0",
        "px-1.5 py-0.5 rounded-sm text shadow-inner wrap-break-word",
      )}
      {...props}
    />
  );
}
