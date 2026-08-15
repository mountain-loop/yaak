import type { Color } from "@yaakapp-internal/plugins";
import type { IconProps } from "@yaakapp-internal/ui";
import { IconButton } from "@yaakapp-internal/ui";
import classNames from "classnames";
import type { ReactNode } from "react";

/**
 * A single control attached to a labelled separator, rendered between the label
 * and the rule.
 *
 * Declared rather than passed as a node so the separator keeps ownership of the
 * things that are easy to get wrong by hand: matching the label's colour, and
 * staying out of the rule's way when the label is long.
 */
export interface SeparatorAction {
  icon: IconProps["icon"];
  /** Tooltip and accessible name. Required — the control is icon-only. */
  title: string;
  onClick: () => void;
}

interface Props {
  orientation?: "horizontal" | "vertical";
  dashed?: boolean;
  className?: string;
  children?: ReactNode;
  color?: Color;
  action?: SeparatorAction;
}

export function Separator({
  color,
  className,
  dashed,
  orientation = "horizontal",
  children,
  action,
}: Props) {
  return (
    <div role="presentation" className={classNames(className, "flex items-center w-full")}>
      {children && (
        <div className="text-sm text-text-subtlest mr-2 whitespace-nowrap">{children}</div>
      )}
      {action && (
        <IconButton
          size="2xs"
          iconSize="xs"
          className="shrink-0 mr-2 -ml-1"
          // Forced, because the button itself sets `text-text` at full strength.
          iconClassName="text-text-subtlest!"
          icon={action.icon}
          title={action.title}
          onClick={action.onClick}
        />
      )}
      <div
        className={classNames(
          "opacity-60",
          // Keep a stub of the line visible no matter how long the label is —
          // `w-full` alone gets squeezed to nothing by a wide label.
          orientation === "horizontal" && "min-w-8",
          color == null && "border-border",
          color === "primary" && "border-primary",
          color === "secondary" && "border-secondary",
          color === "success" && "border-success",
          color === "notice" && "border-notice",
          color === "warning" && "border-warning",
          color === "danger" && "border-danger",
          color === "info" && "border-info",
          dashed && "border-dashed",
          orientation === "horizontal" && "w-full h-0 border-t",
          orientation === "vertical" && "h-full w-0 border-l",
        )}
      />
    </div>
  );
}
