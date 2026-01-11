import type { Virtualizer } from '@tanstack/react-virtual';
import { format } from 'date-fns';
import type { ReactNode } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useEventViewerKeyboard } from '../../hooks/useEventViewerKeyboard';
import { CopyIconButton } from '../CopyIconButton';
import { AutoScroller } from './AutoScroller';
import { Banner } from './Banner';
import { Button } from './Button';
import { Separator } from './Separator';
import { SplitLayout } from './SplitLayout';
import { HStack } from './Stacks';

interface EventViewerProps<T> {
  /** Array of events to display */
  events: T[];

  /** Get unique key for each event */
  getEventKey: (event: T, index: number) => string;

  /** Render the event row - receives event, index, isActive, and onClick */
  renderRow: (props: {
    event: T;
    index: number;
    isActive: boolean;
    onClick: () => void;
  }) => ReactNode;

  /** Render the detail pane for the selected event */
  renderDetail?: (props: { event: T; index: number }) => ReactNode;

  /** Optional header above the event list (e.g., connection status) */
  header?: ReactNode;

  /** Error message to display as a banner */
  error?: string | null;

  /** Name for SplitLayout state persistence */
  splitLayoutName: string;

  /** Default ratio for the split (0.0 - 1.0) */
  defaultRatio?: number;

  /** Enable keyboard navigation (arrow keys) */
  enableKeyboardNav?: boolean;

  /** Loading state */
  isLoading?: boolean;

  /** Message to show while loading */
  loadingMessage?: string;

  /** Message to show when no events */
  emptyMessage?: string;

  /** Callback when active index changes (for controlled state in parent) */
  onActiveIndexChange?: (index: number | null) => void;
}

export function EventViewer<T>({
  events,
  getEventKey,
  renderRow,
  renderDetail,
  header,
  error,
  splitLayoutName,
  defaultRatio = 0.4,
  enableKeyboardNav = true,
  isLoading = false,
  loadingMessage = 'Loading events...',
  emptyMessage = 'No events recorded',
  onActiveIndexChange,
}: EventViewerProps<T>) {
  const [activeIndex, setActiveIndexInternal] = useState<number | null>(null);

  // Wrap setActiveIndex to notify parent
  const setActiveIndex = useCallback(
    (indexOrUpdater: number | null | ((prev: number | null) => number | null)) => {
      setActiveIndexInternal((prev) => {
        const newIndex =
          typeof indexOrUpdater === 'function' ? indexOrUpdater(prev) : indexOrUpdater;
        onActiveIndexChange?.(newIndex);
        return newIndex;
      });
    },
    [onActiveIndexChange],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const virtualizerRef = useRef<Virtualizer<HTMLDivElement, Element> | null>(null);

  const activeEvent = useMemo(
    () => (activeIndex != null ? events[activeIndex] : null),
    [activeIndex, events],
  );

  // Check if the event list container is focused
  const isContainerFocused = useCallback(() => {
    return containerRef.current?.contains(document.activeElement) ?? false;
  }, []);

  // Keyboard navigation
  useEventViewerKeyboard({
    totalCount: events.length,
    activeIndex,
    setActiveIndex,
    virtualizer: virtualizerRef.current,
    isContainerFocused,
    enabled: enableKeyboardNav,
  });

  // Handle virtualizer ready callback
  const handleVirtualizerReady = useCallback(
    (virtualizer: Virtualizer<HTMLDivElement, Element>) => {
      virtualizerRef.current = virtualizer;
    },
    [],
  );

  // Toggle selection on click
  const handleRowClick = useCallback(
    (index: number) => {
      setActiveIndex((prev) => (prev === index ? null : index));
    },
    [setActiveIndex],
  );

  if (isLoading) {
    return <div className="p-3 text-text-subtlest italic">{loadingMessage}</div>;
  }

  if (events.length === 0 && !error) {
    return <div className="p-3 text-text-subtlest italic">{emptyMessage}</div>;
  }

  return (
    <div ref={containerRef} className="h-full">
      <SplitLayout
        layout="vertical"
        name={splitLayoutName}
        defaultRatio={defaultRatio}
        minHeightPx={10}
        firstSlot={({ style }) => (
          <div style={style} className="w-full h-full grid grid-rows-[auto_minmax(0,1fr)]">
            {header ?? <span aria-hidden />}
            <AutoScroller
              data={events}
              focusable={enableKeyboardNav}
              onVirtualizerReady={handleVirtualizerReady}
              header={
                error && (
                  <Banner color="danger" className="m-3">
                    {error}
                  </Banner>
                )
              }
              render={(event, index) => (
                <div key={getEventKey(event, index)}>
                  {renderRow({
                    event,
                    index,
                    isActive: index === activeIndex,
                    onClick: () => handleRowClick(index),
                  })}
                </div>
              )}
            />
          </div>
        )}
        secondSlot={
          activeEvent != null && renderDetail
            ? ({ style }) => (
                <div style={style} className="grid grid-rows-[auto_minmax(0,1fr)] bg-surface">
                  <div className="pb-3 px-2">
                    <Separator />
                  </div>
                  <div className="mx-2 overflow-y-auto">
                    {renderDetail({ event: activeEvent, index: activeIndex ?? 0 })}
                  </div>
                </div>
              )
            : null
        }
      />
    </div>
  );
}

export interface EventDetailAction {
  /** Unique key for React */
  key: string;
  /** Button label */
  label: string;
  /** Optional icon */
  icon?: ReactNode;
  /** Click handler */
  onClick: () => void;
}

interface EventDetailHeaderProps {
  /** Title/label for the event */
  title: string;
  /** Timestamp string (ISO format) - will be formatted as HH:mm:ss.SSS */
  timestamp?: string;
  /** Optional action buttons to show before timestamp */
  actions?: EventDetailAction[];
  /** Text to copy when copy button is clicked - renders a copy icon button after actions */
  copyText?: string;
}

/** Standardized header for event detail panes */
export function EventDetailHeader({
  title,
  timestamp,
  actions,
  copyText,
}: EventDetailHeaderProps) {
  const formattedTime = timestamp ? format(new Date(`${timestamp}Z`), 'HH:mm:ss.SSS') : null;

  return (
    <div className="flex items-center justify-between gap-2 mb-2 h-xs">
      <h3 className="font-semibold select-auto cursor-auto">{title}</h3>
      <HStack space={2} className="items-center">
        {actions?.map((action) => (
          <Button key={action.key} variant="border" size="xs" onClick={action.onClick}>
            {action.icon}
            {action.label}
          </Button>
        ))}
        {copyText != null && (
          <CopyIconButton text={copyText} size="xs" title="Copy" variant="border" iconSize="sm" />
        )}
        {formattedTime && (
          <span className="text-text-subtlest font-mono text-editor">{formattedTime}</span>
        )}
      </HStack>
    </div>
  );
}
