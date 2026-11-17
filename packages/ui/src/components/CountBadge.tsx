import type { Color } from "@yaakapp-internal/plugins";
import classNames from "classnames";

interface Props {
  /** A number, a dot for `true`, or a short word such as a body's type */
  count: number | true | string;
  count2?: number | true;
  className?: string;
  color?: Color;
  showZero?: boolean;
}

export function CountBadge({ count, count2, className, color, showZero }: Props) {
  if (count === 0 && !showZero) return null;

  return (
    <div
      aria-hidden
      className={classNames(
        className,
        "flex items-center",
        "opacity-70 border text-4xs rounded-sm mb-0.5 px-1 ml-1 h-4 font-mono",
        color == null && "border-border-subtle",
        color === "primary" && "text-primary",
        color === "secondary" && "text-secondary",
        color === "success" && "text-success",
        color === "notice" && "text-notice",
        color === "info" && "text-info",
        color === "warning" && "text-warning",
        color === "danger" && "text-danger",
      )}
    >
      {count === true ? (
        <div aria-hidden className="rounded-full h-1 w-1 bg-[currentColor]" />
      ) : (
        count
      )}
      {count2 != null && (
        <>
          /
          {count2 === true ? (
            <div aria-hidden className="rounded-full h-1 w-1 bg-[currentColor]" />
          ) : (
            count2
          )}
        </>
      )}
    </div>
  );
}
