import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import type { ReactElement, ReactNode, UIEvent } from 'react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { IconButton } from './IconButton';

interface Props<T> {
  data: T[];
  render: (item: T, index: number) => ReactElement<HTMLElement>;
  header?: ReactNode;
  /** Make container focusable for keyboard navigation */
  focusable?: boolean;
  /** Callback to expose the virtualizer for keyboard navigation */
  onVirtualizerReady?: (virtualizer: Virtualizer<HTMLDivElement, Element>) => void;
}

export function AutoScroller<T>({
  data,
  render,
  header,
  focusable = false,
  onVirtualizerReady,
}: Props<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);

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

  // Scroll to new items
  const handleScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;

      // Set auto-scroll when container is scrolled
      const pixelsFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
      const newAutoScroll = pixelsFromBottom <= 0;
      if (newAutoScroll !== autoScroll) {
        setAutoScroll(newAutoScroll);
      }
    },
    [autoScroll],
  );

  // Scroll to bottom on count change
  useLayoutEffect(() => {
    if (!autoScroll) return;

    data.length; // Make linter happy. We want to refresh when length changes

    const el = containerRef.current;
    if (el == null) return;

    el.scrollTop = el.scrollHeight;
  }, [autoScroll, data.length]);

  return (
    <div className="h-full w-full relative grid grid-rows-[auto_minmax(0,1fr)]">
      {!autoScroll && (
        <div className="absolute bottom-0 right-0 m-2">
          <IconButton
            title="Lock scroll to bottom"
            icon="arrow_down"
            size="sm"
            iconSize="md"
            variant="border"
            className="!bg-surface z-10"
            onClick={() => setAutoScroll((v) => !v)}
          />
        </div>
      )}
      {header ?? <span aria-hidden />}
      <div
        ref={containerRef}
        className="h-full w-full overflow-y-auto focus:outline-none"
        onScroll={handleScroll}
        tabIndex={focusable ? 0 : undefined}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualItem) => {
            const item = data[virtualItem.index];
            return (
              item != null && (
                <div
                  key={virtualItem.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
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
