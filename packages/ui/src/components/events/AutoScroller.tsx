import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import classNames from "classnames";
import type { ReactElement, ReactNode, UIEvent } from "react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../Icon";
import { IconButton } from "../IconButton";

interface Props<T> {
  data: T[];
  render: (item: T, index: number) => ReactElement<HTMLElement>;
  header?: ReactNode;
  /** Make container focusable for keyboard navigation */
  focusable?: boolean;
  /** Callback to expose the virtualizer for keyboard navigation */
  onVirtualizerReady?: (virtualizer: Virtualizer<HTMLDivElement, Element>) => void;
  /**
   * Holds and catches up as the proxy's flow list does: once scrolled away from the end (or
   * `holdSignal` changes), new items wait under a pill counting them, which scrolls back down.
   * Without it, a button locks the scroll to the bottom again.
   */
  catchUp?: { label: (count: number) => string };
  /** Holds the scroll where it is whenever this changes, as selecting an item does */
  holdSignal?: unknown;
}

export function AutoScroller<T>({
  data,
  render,
  header,
  focusable = false,
  onVirtualizerReady,
  catchUp,
  holdSignal,
}: Props<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  // How many items there were when the scroll was held, to count the new ones
  const [heldAt, setHeldAt] = useState<number>(0);
  const latestLength = useRef(data.length);
  latestLength.current = data.length;

  // The virtualizer
  const rowVirtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 27, // react-virtual requires a height, so we'll give it one
  });

  // Expose virtualizer to parent for keyboard navigation
  useLayoutEffect(() => {
    onVirtualizerReady?.(rowVirtualizer);
  }, [rowVirtualizer, onVirtualizerReady]);

  const hold = useCallback(() => {
    setAutoScroll(false);
    setHeldAt(latestLength.current);
  }, []);

  // Scroll to new items
  const handleScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;

      // Set auto-scroll when container is scrolled
      const pixelsFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
      const newAutoScroll = pixelsFromBottom <= 0;
      if (newAutoScroll !== autoScroll) {
        if (newAutoScroll) setAutoScroll(true);
        else hold();
      }
    },
    [autoScroll, hold],
  );

  // Selecting an item holds the list where it is
  const lastHoldSignal = useRef(holdSignal);
  useLayoutEffect(() => {
    if (Object.is(lastHoldSignal.current, holdSignal)) return;
    lastHoldSignal.current = holdSignal;
    if (catchUp != null && autoScroll) hold();
  }, [autoScroll, catchUp, hold, holdSignal]);

  // Scroll to bottom on count change
  useLayoutEffect(() => {
    if (!autoScroll) return;

    void data.length; // Trigger refresh when length changes

    const el = containerRef.current;
    if (el == null) return;

    el.scrollTop = el.scrollHeight;
  }, [autoScroll, data.length]);

  const newCount = data.length - heldAt;

  return (
    <div className="h-full w-full relative grid grid-rows-[auto_minmax(0,1fr)]">
      {!autoScroll && catchUp == null && (
        <div className="absolute bottom-0 right-0 m-2">
          <IconButton
            title="Lock scroll to bottom"
            icon="arrow_down"
            size="sm"
            iconSize="md"
            variant="border"
            className="bg-surface! z-10"
            onClick={() => setAutoScroll((v) => !v)}
          />
        </div>
      )}
      {!autoScroll && catchUp != null && newCount > 0 && (
        <button
          type="button"
          onClick={() => setAutoScroll(true)}
          className={classNames(
            "absolute bottom-3 left-1/2 -translate-x-1/2 z-10",
            "flex items-center gap-1.5 h-6 px-3 rounded-full",
            "bg-surface border border-border shadow-lg text-text text-xs tabular-nums",
            "hover:bg-surface-highlight",
          )}
        >
          <Icon icon="arrow_down_to_line" size="sm" color="primary" />
          {catchUp.label(newCount)}
        </button>
      )}
      {header ?? <span aria-hidden />}
      <div
        ref={containerRef}
        className="h-full w-full overflow-y-auto focus:outline-hidden"
        onScroll={handleScroll}
        tabIndex={focusable ? 0 : undefined}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualItem) => {
            const item = data[virtualItem.index];
            return (
              item != null && (
                <div
                  key={virtualItem.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualItem.size}px`,
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  {render(item, virtualItem.index)}
                </div>
              )
            );
          })}
        </div>
      </div>
    </div>
  );
}
