import classNames from "classnames";
import { format } from "date-fns";
import type { CSSProperties, ReactNode } from "react";

interface EventViewerRowProps {
  isActive: boolean;
  onClick: () => void;
  icon: ReactNode;
  content: ReactNode;
  timestamp?: string;
  /**
   * Cells after the icon and content, as a message list's type, size and time columns. When
   * given, `columns` lays out the icon, `content` and these, and `timestamp` is not drawn.
   */
  cells?: { kind?: ReactNode; trailing?: ReactNode[] };
  /** The grid's `grid-template-columns`, for `cells` */
  columns?: string;
}

export function EventViewerRow({
  isActive,
  onClick,
  icon,
  content,
  timestamp,
  cells,
  columns,
}: EventViewerRowProps) {
  const style: CSSProperties | undefined =
    cells != null && columns != null ? { gridTemplateColumns: columns } : undefined;
  return (
    <div className="px-1">
      <button
        type="button"
        onClick={onClick}
        style={style}
        className={classNames(
          "w-full grid gap-2 items-center text-left",
          style == null && "grid-cols-[auto_minmax(0,1fr)_auto]",
          "px-1.5 h-xs font-mono text-editor cursor-default group focus:outline-hidden focus:text-text rounded-sm",
          isActive && "bg-surface-active text-text!",
          "text-text-subtle hover:text",
        )}
      >
        {icon}
        {cells?.kind != null && <div className="truncate">{cells.kind}</div>}
        <div className="w-full truncate">{content}</div>
        {style == null
          ? timestamp && <div className="opacity-50">{format(`${timestamp}Z`, "HH:mm:ss.SSS")}</div>
          : cells?.trailing?.map((cell, i) => (
              // oxlint-disable-next-line no-array-index-key -- fixed columns, in order
              <div key={i} className="truncate text-right">
                {cell}
              </div>
            ))}
      </button>
    </div>
  );
}
