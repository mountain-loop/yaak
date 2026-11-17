import classNames from "classnames";
import type { CSSProperties } from "react";

interface HeaderTintProps {
  /** Any CSS colour, or null for no tint */
  color: string | null;
  /** Fade between colours when the colour changes */
  animate?: boolean;
}

// Drawn in currentColor so a change of colour can fade: a gradient itself can't transition.
const GRADIENT: CSSProperties = {
  background: "linear-gradient(to right, currentColor 15%, transparent 40%)",
};

/**
 * A colour wash from a header's left edge, with a line of it along the bottom border, placed
 * inside a `HeaderSize`. It takes no pointer, so clicks and window drags reach the header.
 */
export function HeaderTint({ color, animate }: HeaderTintProps) {
  return (
    <div
      aria-hidden
      style={{ color: isColor(color) ? color : "transparent" }}
      className={classNames(
        "absolute inset-0 pointer-events-none",
        animate && "transition-[color] duration-200",
      )}
    >
      <div style={GRADIENT} className="absolute inset-0 opacity-[0.07]" />
      <div style={GRADIENT} className="absolute left-0 right-0 -bottom-px h-px opacity-20" />
    </div>
  );
}

/** An unreadable colour draws nothing, rather than falling back to the inherited text colour */
function isColor(color: string | null): color is string {
  if (color == null || color === "") return false;
  return typeof CSS === "undefined" || CSS.supports("color", color);
}
