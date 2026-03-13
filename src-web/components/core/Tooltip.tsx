import classNames from "classnames";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { useRef, useState } from "react";
import { generateId } from "../../lib/generateId";
import { Portal } from "../Portal";

export interface TooltipProps {
  children: ReactNode;
  content: ReactNode;
  tabIndex?: number;
  size?: "md" | "lg";
  className?: string;
}

const hiddenStyles: CSSProperties = {
  left: -99999,
  top: -99999,
  visibility: "hidden",
  pointerEvents: "none",
  opacity: 0,
};

type TooltipPosition = "top" | "bottom";

interface TooltipOpenState {
  styles: CSSProperties;
  position: TooltipPosition;
}

export function Tooltip({ children, className, content, tabIndex, size = "md" }: TooltipProps) {
  const [openState, setOpenState] = useState<TooltipOpenState | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const showTimeout = useRef<NodeJS.Timeout>(undefined);

  const handleOpenImmediate = () => {
    if (triggerRef.current == null || tooltipRef.current == null) return;
    clearTimeout(showTimeout.current);
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const viewportHeight = document.documentElement.clientHeight;

    const margin = 8;
    const spaceAbove = Math.max(0, triggerRect.top - margin);
    const spaceBelow = Math.max(0, viewportHeight - triggerRect.bottom - margin);
    const preferBottom = spaceAbove < tooltipRect.height + margin && spaceBelow > spaceAbove;
    const position: TooltipPosition = preferBottom ? "bottom" : "top";

    const styles: CSSProperties = {
      left: Math.max(0, triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2),
      maxHeight: position === "top" ? spaceAbove : spaceBelow,
      ...(position === "top"
        ? { bottom: viewportHeight - triggerRect.top }
        : { top: triggerRect.bottom }),
    };

    setOpenState({ styles, position });
  };

  const handleOpen = () => {
    clearTimeout(showTimeout.current);
    showTimeout.current = setTimeout(handleOpenImmediate, 500);
  };

  const handleClose = () => {
    clearTimeout(showTimeout.current);
    setOpenState(null);
  };

  const handleToggleImmediate = () => {
    if (openState) handleClose();
    else handleOpenImmediate();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (openState && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      handleClose();
    }
  };

  const id = useRef(`tooltip-${generateId()}`);

  return (
    <>
      <Portal name="tooltip">
        <div
          ref={tooltipRef}
          style={openState?.styles ?? hiddenStyles}
          id={id.current}
          role="tooltip"
          aria-hidden={openState == null}
          onMouseEnter={handleOpenImmediate}
          onMouseLeave={handleClose}
          className="p-2 fixed z-50 text-sm transition-opacity grid grid-rows-[minmax(0,1fr)]"
        >
          <div
            className={classNames(
              "bg-surface-highlight rounded-md px-3 py-2 z-50 border border-border overflow-auto",
              size === "md" && "max-w-sm",
              size === "lg" && "max-w-md",
            )}
          >
            {content}
          </div>
          <Triangle
            className="text-border"
            position={openState?.position === "bottom" ? "top" : "bottom"}
          />
        </div>
      </Portal>
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Needs to be usable in other buttons */}
      <span
        ref={triggerRef}
        role="button"
        aria-describedby={openState ? id.current : undefined}
        tabIndex={tabIndex ?? -1}
        className={classNames(className, "flex-grow-0 flex items-center")}
        onClick={handleToggleImmediate}
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
        onFocus={handleOpenImmediate}
        onBlur={handleClose}
        onKeyDown={handleKeyDown}
      >
        {children}
      </span>
    </>
  );
}

function Triangle({ className, position }: { className?: string; position: "top" | "bottom" }) {
  const isBottom = position === "bottom";

  return (
    <svg
      aria-hidden
      viewBox="0 0 30 10"
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      className={classNames(
        className,
        "absolute z-50 left-[calc(50%-0.4rem)] h-[0.5rem] w-[0.8rem]",
        isBottom
          ? "border-t-[2px] border-surface-highlight -bottom-[calc(0.5rem-3px)] mb-2"
          : "border-b-[2px] border-surface-highlight -top-[calc(0.5rem-3px)] mt-2",
      )}
    >
      <title>Triangle</title>
      <polygon
        className="fill-surface-highlight"
        points={isBottom ? "0,0 30,0 15,10" : "0,10 30,10 15,0"}
      />
      <path
        d={isBottom ? "M0 0 L15 9 L30 0" : "M0 10 L15 1 L30 10"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="miter"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
