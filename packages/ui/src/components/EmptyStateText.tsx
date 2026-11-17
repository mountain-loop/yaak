import classNames from "classnames";
import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
  wrapperClassName?: string;
}

export function EmptyStateText({ children, className, wrapperClassName }: Props) {
  return (
    <div className={classNames("w-full h-full pb-2", wrapperClassName)}>
      <div
        className={classNames(
          className,
          "rounded-lg border border-dashed border-border-subtle",
          "h-full py-2 text-text-subtlest flex items-center justify-center italic",
        )}
      >
        {children}
      </div>
    </div>
  );
}
