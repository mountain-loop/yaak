import classNames from "classnames";
import type { ReactNode } from "react";

/** For the positioned element an `ActionsBar` sits in: hovering it brings the bar's actions in */
export const ACTIONS_BAR_CONTAINER = "relative group/actions";

/** Set on an action's outermost element to keep it in view, as a control that shows state does */
export const PINNED_ACTION = { "data-pinned": true } as const;

interface Props {
  children: ReactNode;
  className?: string;
}

/**
 * A row of actions over the bottom-right corner of the content in an `ACTIONS_BAR_CONTAINER`:
 * small bordered buttons on the surface colour, so they read over text, each held to the height
 * and radius of an `sm` icon button and centred on the row. Each fades in while the
 * container is hovered or the action has focus, unless it carries `PINNED_ACTION`. The row lets
 * clicks through to the content between its actions.
 */
export function ActionsBar({ children, className }: Props) {
  return (
    <div
      className={classNames(
        className,
        "absolute bottom-2 left-0 right-0 z-10 flex items-center justify-end gap-1",
        "pointer-events-none",
        "*:pointer-events-auto *:bg-surface *:shadow *:transition-opacity *:transform-gpu",
        // Every action as tall and as round as a small icon button, so they line up
        "*:h-sm *:rounded-md",
        "[&>:not([data-pinned])]:opacity-0",
        "group-hover/actions:*:opacity-100! *:focus-within:opacity-100! *:hover:opacity-100!",
      )}
    >
      {children}
    </div>
  );
}
