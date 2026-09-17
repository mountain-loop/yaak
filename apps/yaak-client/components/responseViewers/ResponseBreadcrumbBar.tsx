import { Icon } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { JsonPathSegment } from "../core/Editor/json/jsonPath";
import { IconButton } from "../core/IconButton";
import { Tooltip } from "../core/Tooltip";

interface Props {
  segments: JsonPathSegment[];
  appliedFilter: string | null;
  /**
   * How many leading segments make up the applied filter. `null` when unfiltered, or
   * when the filter isn't a plain path and is shown as raw text instead.
   */
  appliedDepth: number | null;
  filterError: boolean;
  /** Called with the number of leading segments to filter to. `0` clears the filter. */
  onSelect: (count: number) => void;
}

/**
 * Shows where the cursor sits inside a response (`$ > sort > [0] > id`). An applied
 * plain-path filter is the start of the trail, so any crumb moves it. While filtered,
 * the bar is tinted so a lingering filter is hard to miss.
 */
export function ResponseBreadcrumbBar({
  segments,
  appliedFilter,
  appliedDepth,
  filterError,
  onSelect,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (el == null) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setOverflow({
      left: el.scrollLeft > 1,
      right: el.scrollLeft < maxScroll - 1,
    });
  }, []);

  // Keep the deepest crumb (where the cursor is) in view as the path changes.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el == null) return;
    el.scrollLeft = el.scrollWidth;
    measure();
  }, [segments, measure]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el == null) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const scrollBy = useCallback((direction: -1 | 1) => {
    const el = scrollRef.current;
    if (el == null) return;
    el.scrollBy({ left: direction * Math.max(120, el.clientWidth * 0.6), behavior: "smooth" });
  }, []);

  const isFiltered = appliedFilter != null;

  return (
    <div className="rounded bg-surface shadow pointer-events-auto">
      <div
        className={classNames(
          "flex items-stretch h-6 rounded border overflow-hidden font-mono text-xs text-text-subtle select-none",
          !isFiltered && "border-border-subtle",
          isFiltered && !filterError && "border-primary/40 bg-primary/10",
          filterError && "border-danger/40 bg-danger/10",
        )}
      >
        {isFiltered && appliedDepth == null ? (
          <span
            className={classNames(
              "flex items-center min-w-0 truncate px-2",
              filterError ? "text-danger" : "text-primary",
            )}
          >
            {appliedFilter}
          </span>
        ) : (
          <Crumb
            label="$"
            tooltip="Clear filter"
            isApplied={isFiltered}
            onClick={appliedDepth != null && appliedDepth > 0 ? () => onSelect(0) : null}
          />
        )}
        {overflow.left && (
          <IconButton
            size="xs"
            icon="chevron_left"
            title="Scroll breadcrumbs left"
            iconColor="secondary"
            onClick={() => scrollBy(-1)}
            className="shrink-0 h-auto!"
          />
        )}
        <div
          ref={scrollRef}
          onScroll={measure}
          className="flex items-stretch min-w-0 overflow-x-auto hide-scrollbars whitespace-nowrap"
        >
          {segments.map((segment, i) => {
            const count = i + 1;
            const isApplied = appliedDepth != null && count <= appliedDepth;
            const isClickable = (!isFiltered || appliedDepth != null) && count !== appliedDepth;
            return (
              <div key={i} className="flex items-stretch shrink-0">
                <Icon
                  icon="chevron_right"
                  size="xs"
                  className="text-text-subtlest shrink-0 self-center"
                />
                <Crumb
                  label={segment.kind === "index" ? `[${segment.index}]` : segment.key}
                  tooltip={
                    segment.kind === "index"
                      ? `Filter to element ${segment.index}`
                      : `Filter to ${segment.key}`
                  }
                  isApplied={isApplied}
                  onClick={isClickable ? () => onSelect(count) : null}
                />
              </div>
            );
          })}
        </div>
        {overflow.right && (
          <IconButton
            size="xs"
            icon="chevron_right"
            title="Scroll breadcrumbs right"
            iconColor="secondary"
            onClick={() => scrollBy(1)}
            className="shrink-0 h-auto!"
          />
        )}
      </div>
    </div>
  );
}

function Crumb({
  label,
  tooltip,
  isApplied,
  onClick,
}: {
  label: string;
  tooltip: string;
  isApplied: boolean;
  onClick: (() => void) | null;
}) {
  const outerClassName = classNames("flex items-center px-0.5 py-0.5", isApplied && "text-primary");
  const innerClassName = "flex items-center h-full px-1 rounded-sm";
  if (onClick == null) {
    return (
      <span className={classNames(outerClassName, "shrink-0")}>
        <span className={innerClassName}>{label}</span>
      </span>
    );
  }

  return (
    <Tooltip content={tooltip} className="shrink-0 items-stretch!">
      <button
        type="button"
        onClick={onClick}
        className={classNames(outerClassName, "group/crumb focus-visible:outline-none")}
      >
        <span
          className={classNames(
            innerClassName,
            "transition-colors group-hover/crumb:text-text group-hover/crumb:bg-surface-highlight",
            "group-focus-visible/crumb:ring-1 group-focus-visible/crumb:ring-border-focus",
          )}
        >
          {label}
        </span>
      </button>
    </Tooltip>
  );
}
