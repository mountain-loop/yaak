import classNames from "classnames";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { generateId } from "@yaakapp-internal/lib/generateId";
import { Portal } from "./Portal";

export interface TooltipProps {
  children: ReactNode;
  content: ReactNode;
  tabIndex?: number;
  size?: "md" | "lg";
  className?: string;
  /** How long the pointer rests before it shows, in milliseconds */
  delay?: number;
  /**
   * Wraps a control or a cell without a box of its own: shown on hover alone, hidden on a press,
   * and placed against the first element inside, which keeps its own focus and clicks
   */
  wrap?: boolean;
  /** Shown only while something inside is cut short, as a long host in a narrow column is */
  onlyWhenTruncated?: boolean;
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

export function Tooltip({
  children,
  className,
  content,
  tabIndex,
  size = "md",
  delay = 500,
  wrap = false,
  onlyWhenTruncated = false,
}: TooltipProps) {
  // Open, then placed once measured; the tooltip is only in the page while open.
  const [open, setOpen] = useState(false);
  const [openState, setOpenState] = useState<TooltipOpenState | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const showTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(showTimeout.current), []);

  useLayoutEffect(() => {
    if (!open) {
      setOpenState(null);
      return;
    }
    const trigger = anchorOf(triggerRef.current, wrap);
    if (trigger == null || tooltipRef.current == null) return;
    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const viewportHeight = document.documentElement.clientHeight;
    const viewportWidth = document.documentElement.clientWidth;

    const margin = 8;
    const spaceAbove = Math.max(0, triggerRect.top - margin);
    const spaceBelow = Math.max(0, viewportHeight - triggerRect.bottom - margin);
    const preferBottom = spaceAbove < tooltipRect.height + margin && spaceBelow > spaceAbove;
    const position: TooltipPosition = preferBottom ? "bottom" : "top";
    const centred = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;

    const styles: CSSProperties = {
      left: Math.max(0, Math.min(centred, viewportWidth - tooltipRect.width)),
      maxHeight: position === "top" ? spaceAbove : spaceBelow,
      ...(position === "top"
        ? { bottom: viewportHeight - triggerRect.top }
        : { top: triggerRect.bottom }),
    };

    setOpenState({ styles, position });
  }, [open, wrap]);

  const handleOpenImmediate = () => {
    clearTimeout(showTimeout.current);
    if (onlyWhenTruncated && !isTruncated(anchorOf(triggerRef.current, wrap))) return;
    setOpen(true);
  };

  const handleOpen = () => {
    clearTimeout(showTimeout.current);
    showTimeout.current = setTimeout(handleOpenImmediate, delay);
  };

  const handleClose = () => {
    clearTimeout(showTimeout.current);
    setOpen(false);
  };

  const handleToggleImmediate = () => {
    if (open) handleClose();
    else handleOpenImmediate();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (open && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      handleClose();
    }
  };

  const id = useRef(`tooltip-${generateId()}`);

  return (
    <>
      {open && (
        <Portal name="tooltip">
          <div
            ref={tooltipRef}
            style={openState?.styles ?? hiddenStyles}
            id={id.current}
            role="tooltip"
            onMouseEnter={wrap ? undefined : handleOpenImmediate}
            onMouseLeave={wrap ? undefined : handleClose}
            className={classNames(
              "p-2 fixed z-50 text-sm transition-opacity grid grid-rows-[minmax(0,1fr)]",
              wrap && "pointer-events-none",
            )}
          >
            <div
              className={classNames(
                "bg-surface-highlight rounded-md px-3 py-2 z-50 border border-border overflow-auto",
                // Text keeps its line breaks, for a tooltip listing a few things
                typeof content === "string" && "break-words whitespace-pre-line",
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
      )}
      {wrap ? (
        // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- hover only; what it wraps keeps its own focus and clicks
        <span
          ref={triggerRef}
          aria-describedby={openState ? id.current : undefined}
          className={classNames(className, "contents")}
          onMouseEnter={handleOpen}
          onMouseLeave={handleClose}
          onMouseDown={handleClose}
        >
          {children}
        </span>
      ) : (
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Needs to be usable in other buttons
        <span
          ref={triggerRef}
          role="button"
          aria-describedby={openState ? id.current : undefined}
          tabIndex={tabIndex ?? -1}
          className={classNames(className, "grow-0 flex items-center")}
          onClick={handleToggleImmediate}
          onMouseEnter={handleOpen}
          onMouseLeave={handleClose}
          onFocus={handleOpenImmediate}
          onBlur={handleClose}
          onKeyDown={handleKeyDown}
        >
          {children}
        </span>
      )}
    </>
  );
}

/** What the tooltip is placed against: the trigger, or a wrapping one's first element */
function anchorOf(trigger: HTMLElement | null, wrap: boolean): Element | null {
  if (trigger == null) return null;
  return wrap ? (trigger.firstElementChild ?? trigger) : trigger;
}

/** Whether `el`, or anything in it, is cut short */
function isTruncated(el: Element | null): boolean {
  if (el == null) return false;
  if (el.scrollWidth > el.clientWidth + 1) return true;
  for (const child of el.querySelectorAll("*")) {
    if (child.scrollWidth > child.clientWidth + 1) return true;
  }
  return false;
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
        "absolute z-50 left-[calc(50%-0.4rem)] h-2 w-[0.8rem]",
        isBottom
          ? "border-t-2 border-surface-highlight -bottom-[calc(0.5rem-3px)] mb-2"
          : "border-b-2 border-surface-highlight -top-[calc(0.5rem-3px)] mt-2",
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
