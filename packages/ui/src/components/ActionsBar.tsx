import classNames from "classnames";
import type { ReactNode } from "react";

/** For the positioned element an `ActionsBar` sits in: hovering it brings the bar's actions in */
export const ACTIONS_BAR_CONTAINER = "relative group/actions";

/** Set on an action's outermost element to keep it in view, as a control that shows state does */
export const PINNED_ACTION = { "data-pinned": true } as const;

/**
 * Where every bar sits in its container, the same for every viewer: flush with the content's
 * right edge, which a text viewer's scrollbar sits just past, and lifted off the bottom edge
 * above its horizontal scrollbar. Not overridable, so bars line up from pane to pane.
 */
const ACTIONS_BAR_INSET = "bottom-2 right-0 left-0";

interface Props {
  children: ReactNode;
}

/**
 * A row of actions over the bottom-right corner of the content in an `ACTIONS_BAR_CONTAINER`:
 * small bordered buttons on the surface colour, so they read over text, each held to the height
 * and radius of an `sm` icon button and centred on the row. Each fades in while the
 * container is hovered or the action has focus, unless it carries `PINNED_ACTION`. The row lets
 * clicks through to the content between its actions. Place the container over the whole tab
 * content, not a viewer's inner box, so the bar's inset is the pane's.
 */
export function ActionsBar({ children }: Props) {
  return (
    <div
      className={classNames(
        "absolute z-10 flex items-center justify-end gap-1",
        ACTIONS_BAR_INSET,
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
