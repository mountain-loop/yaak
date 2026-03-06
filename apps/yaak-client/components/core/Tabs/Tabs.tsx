import type { DragEndEvent, DragMoveEvent, DragStartEvent } from '@dnd-kit/core';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import classNames from 'classnames';
import type { ReactNode, Ref } from 'react';
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useKeyValue } from '../../../hooks/useKeyValue';
import { computeSideForDragMove } from '../../../lib/dnd';
import { DropMarker } from '../../DropMarker';
import { ErrorBoundary } from '../../ErrorBoundary';
import type { ButtonProps } from '../Button';
import { Button } from '../Button';
import { Icon } from '../Icon';
import type { RadioDropdownProps } from '../RadioDropdown';
import { RadioDropdown } from '../RadioDropdown';

export type TabItem =
  | {
      value: string;
      label: string;
      hidden?: boolean;
      leftSlot?: ReactNode;
      rightSlot?: ReactNode;
    }
  | {
      value: string;
      options: Omit<RadioDropdownProps, 'children'>;
      leftSlot?: ReactNode;
      rightSlot?: ReactNode;
    };

interface TabsStorage {
  order: string[];
  activeTabs: Record<string, string>;
}

export interface TabsRef {
  /** Programmatically set the active tab */
  setActiveTab: (value: string) => void;
}

interface Props {
  label: string;
  /** Default tab value. If not provided, defaults to first tab. */
  defaultValue?: string;
  /** Called when active tab changes */
  onChangeValue?: (value: string) => void;
  tabs: TabItem[];
  tabListClassName?: string;
  className?: string;
  children: ReactNode;
  addBorders?: boolean;
  layout?: 'horizontal' | 'vertical';
  /** Storage key for persisting tab order and active tab. When provided, enables drag-to-reorder and active tab persistence. */
  storageKey?: string | string[];
  /** Key to identify which context this tab belongs to (e.g., request ID). Used for per-context active tab persistence. */
  activeTabKey?: string;
}

export const Tabs = forwardRef<TabsRef, Props>(function Tabs(
  {
    defaultValue,
    onChangeValue: onChangeValueProp,
    label,
    children,
    tabs: originalTabs,
    className,
    tabListClassName,
    addBorders,
    layout = 'vertical',
    storageKey,
    activeTabKey,
  }: Props,
  forwardedRef: Ref<TabsRef>,
) {
  const ref = useRef<HTMLDivElement | null>(null);
  const reorderable = !!storageKey;

  // Use key-value storage for persistence if storageKey is provided
  // Handle migration from old format (string[]) to new format (TabsStorage)
  const { value: rawStorage, set: setStorage } = useKeyValue<TabsStorage | string[]>({
    namespace: 'no_sync',
    key: storageKey ?? ['tabs', 'default'],
    fallback: { order: [], activeTabs: {} },
  });

  // Migrate old format (string[]) to new format (TabsStorage)
  const storage: TabsStorage = Array.isArray(rawStorage)
    ? { order: rawStorage, activeTabs: {} }
    : (rawStorage ?? { order: [], activeTabs: {} });

  const savedOrder = storage.order;

  // Get the active tab value - prefer storage (if activeTabKey), then defaultValue, then first tab
  const storedActiveTab = activeTabKey ? storage?.activeTabs?.[activeTabKey] : undefined;
  const [internalValue, setInternalValue] = useState<string | undefined>(undefined);
  const value = storedActiveTab ?? internalValue ?? defaultValue ?? originalTabs[0]?.value;

  // Helper to normalize storage (handle migration from old format)
  const normalizeStorage = useCallback(
    (s: TabsStorage | string[]): TabsStorage =>
      Array.isArray(s) ? { order: s, activeTabs: {} } : s,
    [],
  );

  // Handle tab change - update internal state, storage if we have a key, and call prop callback
  const onChangeValue = useCallback(
    async (newValue: string) => {
      setInternalValue(newValue);
      if (storageKey && activeTabKey) {
        await setStorage((s) => {
          const normalized = normalizeStorage(s);
          return {
            ...normalized,
            activeTabs: { ...normalized.activeTabs, [activeTabKey]: newValue },
          };
        });
      }
      onChangeValueProp?.(newValue);
    },
    [storageKey, activeTabKey, setStorage, onChangeValueProp, normalizeStorage],
  );

  // Expose imperative methods via ref
  useImperativeHandle(
    forwardedRef,
    () => ({
      setActiveTab: (value: string) => {
        onChangeValue(value);
      },
    }),
    [onChangeValue],
  );

  // Helper to save order
  const setSavedOrder = useCallback(
    async (order: string[]) => {
      await setStorage((s) => {
        const normalized = normalizeStorage(s);
        return { ...normalized, order };
      });
    },
    [setStorage, normalizeStorage],
  );

  // State for ordered tabs
  const [orderedTabs, setOrderedTabs] = useState<TabItem[]>(originalTabs);
  const [isDragging, setIsDragging] = useState<TabItem | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Reorder tabs based on saved order when tabs or savedOrder changes
  useEffect(() => {
    if (!storageKey || savedOrder == null || savedOrder.length === 0) {
      setOrderedTabs(originalTabs);
      return;
    }

    // Create a map of tab values to tab items
    const tabMap = new Map(originalTabs.map((tab) => [tab.value, tab]));

    // Reorder based on saved order, adding any new tabs at the end
    const reordered: TabItem[] = [];
    const seenValues = new Set<string>();

    // Add tabs in saved order
    for (const value of savedOrder) {
      const tab = tabMap.get(value);
      if (tab) {
        reordered.push(tab);
        seenValues.add(value);
      }
    }

    // Add any new tabs that weren't in the saved order
    for (const tab of originalTabs) {
      if (!seenValues.has(tab.value)) {
        reordered.push(tab);
      }
    }

    setOrderedTabs(reordered);
  }, [originalTabs, savedOrder, storageKey]);

  const tabs = storageKey ? orderedTabs : originalTabs;

  // Update tabs when value changes
  useEffect(() => {
    const tabs = ref.current?.querySelectorAll<HTMLDivElement>('[data-tab]');
    for (const tab of tabs ?? []) {
      const v = tab.getAttribute('data-tab');
      const parent = tab.closest('.tabs-container');
      if (parent !== ref.current) {
        // Tab is part of a nested tab container, so ignore it
      } else if (v === value) {
        tab.setAttribute('data-state', 'active');
        tab.setAttribute('aria-hidden', 'false');
        tab.style.display = 'block';
      } else {
        tab.setAttribute('data-state', 'inactive');
        tab.setAttribute('aria-hidden', 'true');
        tab.style.display = 'none';
      }
    }
  }, [value]);

  // Drag and drop handlers
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragStart = useCallback(
    (e: DragStartEvent) => {
      const tab = tabs.find((t) => t.value === e.active.id);
      setIsDragging(tab ?? null);
    },
    [tabs],
  );

  const onDragMove = useCallback(
    (e: DragMoveEvent) => {
      const overId = e.over?.id as string | undefined;
      if (!overId) return setHoveredIndex(null);

      const overTab = tabs.find((t) => t.value === overId);
      if (overTab == null) return setHoveredIndex(null);

      // For vertical layout, tabs are arranged horizontally (side-by-side)
      const orientation = layout === 'vertical' ? 'horizontal' : 'vertical';
      const side = computeSideForDragMove(overTab.value, e, orientation);

      // If computeSideForDragMove returns null (shouldn't happen but be safe), default to null
      if (side === null) return setHoveredIndex(null);

      const overIndex = tabs.findIndex((t) => t.value === overId);
      const hoveredIndex = overIndex + (side === 'before' ? 0 : 1);

      setHoveredIndex(hoveredIndex);
    },
    [tabs, layout],
  );

  const onDragCancel = useCallback(() => {
    setIsDragging(null);
    setHoveredIndex(null);
  }, []);

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setIsDragging(null);
      setHoveredIndex(null);

      const activeId = e.active.id as string | undefined;
      const overId = e.over?.id as string | undefined;
      if (!activeId || !overId || activeId === overId) return;

      const from = tabs.findIndex((t) => t.value === activeId);
      const baseTo = tabs.findIndex((t) => t.value === overId);
      const to = hoveredIndex ?? (baseTo === -1 ? from : baseTo);

      if (from !== -1 && to !== -1 && from !== to) {
        const newTabs = [...tabs];
        const [moved] = newTabs.splice(from, 1);
        if (moved === undefined) return;
        newTabs.splice(to > from ? to - 1 : to, 0, moved);

        setOrderedTabs(newTabs);

        // Save order to storage
        setSavedOrder(newTabs.map((t) => t.value)).catch(console.error);
      }
    },
    [tabs, hoveredIndex, setSavedOrder],
  );

  const tabButtons = useMemo(() => {
    const items: ReactNode[] = [];
    tabs.forEach((t, i) => {
      if ('hidden' in t && t.hidden) {
        return;
      }

      const isActive = t.value === value;
      const showDropMarkerBefore = hoveredIndex === i;

      if (showDropMarkerBefore) {
        items.push(
          <div
            key={`marker-${t.value}`}
            className={classNames('relative', layout === 'vertical' ? 'w-0' : 'h-0')}
          >
            <DropMarker orientation={layout === 'vertical' ? 'vertical' : 'horizontal'} />
          </div>,
        );
      }

      items.push(
        <TabButton
          key={t.value}
          tab={t}
          isActive={isActive}
          addBorders={addBorders}
          layout={layout}
          reorderable={reorderable}
          isDragging={isDragging?.value === t.value}
          onChangeValue={onChangeValue}
        />,
      );
    });
    return items;
  }, [tabs, value, addBorders, layout, reorderable, isDragging, onChangeValue, hoveredIndex]);

  const tabList = (
    <div
      role="tablist"
      aria-label={label}
      className={classNames(
        tabListClassName,
        addBorders && layout === 'horizontal' && 'pl-3 -ml-1',
        addBorders && layout === 'vertical' && 'ml-0 mb-2',
        'flex items-center hide-scrollbars',
        layout === 'horizontal' && 'h-full overflow-auto p-2',
        layout === 'vertical' && 'overflow-x-auto overflow-y-visible ',
        // Give space for button focus states within overflow boundary.
        !addBorders && layout === 'vertical' && 'py-1 pl-3 -ml-5 pr-1',
      )}
    >
      <div
        className={classNames(
          layout === 'horizontal' && 'flex flex-col w-full pb-3 mb-auto',
          layout === 'vertical' && 'flex flex-row flex-shrink-0 w-full',
        )}
      >
        {tabButtons}
        {hoveredIndex === tabs.length && (
          <div className={classNames('relative', layout === 'vertical' ? 'w-0' : 'h-0')}>
            <DropMarker orientation={layout === 'vertical' ? 'vertical' : 'horizontal'} />
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div
      ref={ref}
      className={classNames(
        className,
        'tabs-container',
        'h-full grid',
        layout === 'horizontal' && 'grid-rows-1 grid-cols-[auto_minmax(0,1fr)]',
        layout === 'vertical' && 'grid-rows-[auto_minmax(0,1fr)] grid-cols-1',
      )}
    >
      {reorderable ? (
        <DndContext
          autoScroll
          sensors={sensors}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onDragStart={onDragStart}
          onDragCancel={onDragCancel}
          collisionDetection={closestCenter}
        >
          {tabList}
          <DragOverlay dropAnimation={null}>
            {isDragging && (
              <TabButton
                tab={isDragging}
                isActive={isDragging.value === value}
                addBorders={addBorders}
                layout={layout}
                reorderable={false}
                isDragging={false}
                onChangeValue={onChangeValue}
                overlay
              />
            )}
          </DragOverlay>
        </DndContext>
      ) : (
        tabList
      )}
      {children}
    </div>
  );
});

interface TabButtonProps {
  tab: TabItem;
  isActive: boolean;
  addBorders?: boolean;
  layout: 'horizontal' | 'vertical';
  reorderable: boolean;
  isDragging: boolean;
  onChangeValue?: (value: string) => void;
  overlay?: boolean;
}

function TabButton({
  tab,
  isActive,
  addBorders,
  layout,
  reorderable,
  isDragging,
  onChangeValue,
  overlay = false,
}: TabButtonProps) {
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
  } = useDraggable({
    id: tab.value,
    disabled: !reorderable,
    // The button inside handles focus
    attributes: { tabIndex: -1 },
  });
  const { setNodeRef: setDroppableRef } = useDroppable({
    id: tab.value,
    disabled: !reorderable,
  });

  const handleSetWrapperRef = useCallback(
    (n: HTMLDivElement | null) => {
      if (reorderable) {
        setDraggableRef(n);
        setDroppableRef(n);
      }
    },
    [reorderable, setDraggableRef, setDroppableRef],
  );

  const btnProps: Partial<ButtonProps> = {
    color: 'custom',
    justify: layout === 'horizontal' ? 'start' : 'center',
    onClick: isActive
      ? undefined
      : (e: React.MouseEvent) => {
          e.preventDefault(); // Prevent dropdown from opening on first click
          onChangeValue?.(tab.value);
        },
    className: classNames(
      'flex items-center rounded whitespace-nowrap',
      '!px-2 ml-[1px]',
      'outline-none',
      'ring-none',
      'focus-visible-or-class:outline-2',
      addBorders && 'border focus-visible:bg-surface-highlight',
      isActive ? 'text-text' : 'text-text-subtle',
      isActive && addBorders
        ? 'border-surface-active bg-surface-active'
        : layout === 'vertical'
          ? 'border-border-subtle'
          : 'border-transparent',
      layout === 'horizontal' && 'min-w-[10rem]',
      isDragging && 'opacity-50',
      overlay && 'opacity-80',
    ),
  };

  const buttonContent = (() => {
    if ('options' in tab) {
      const option = tab.options.items.find((i) => 'value' in i && i.value === tab.options.value);
      return (
        <RadioDropdown
          key={tab.value}
          items={tab.options.items}
          itemsAfter={tab.options.itemsAfter}
          itemsBefore={tab.options.itemsBefore}
          value={tab.options.value}
          onChange={tab.options.onChange}
        >
          <Button
            leftSlot={tab.leftSlot}
            rightSlot={
              <div className="flex items-center">
                {tab.rightSlot}
                <Icon
                  size="sm"
                  icon="chevron_down"
                  className={classNames(
                    'ml-1',
                    isActive ? 'text-text-subtle' : 'text-text-subtlest',
                  )}
                />
              </div>
            }
            {...btnProps}
          >
            {option && 'shortLabel' in option && option.shortLabel
              ? option.shortLabel
              : (option?.label ?? 'Unknown')}
          </Button>
        </RadioDropdown>
      );
    }
    return (
      <Button leftSlot={tab.leftSlot} rightSlot={tab.rightSlot} {...btnProps}>
        {'label' in tab && tab.label ? tab.label : tab.value}
      </Button>
    );
  })();

  // Apply drag handlers to wrapper, not button
  const wrapperProps = reorderable && !overlay ? { ...attributes, ...listeners } : {};

  return (
    <div
      ref={handleSetWrapperRef}
      className={classNames('relative', layout === 'vertical' && 'mr-2')}
      {...wrapperProps}
    >
      {buttonContent}
    </div>
  );
}

interface TabContentProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export const TabContent = memo(function TabContent({
  value,
  children,
  className,
}: TabContentProps) {
  return (
    <ErrorBoundary name={`Tab ${value}`}>
      <div
        tabIndex={-1}
        data-tab={value}
        className={classNames(className, 'tab-content', 'hidden w-full h-full pt-2')}
      >
        {children}
      </div>
    </ErrorBoundary>
  );
});

/**
 * Programmatically set the active tab for a Tabs component that uses storageKey + activeTabKey.
 * This is useful when you need to change the tab from outside the component (e.g., in response to an event).
 */
export async function setActiveTab({
  storageKey,
  activeTabKey,
  value,
}: {
  storageKey: string;
  activeTabKey: string;
  value: string;
}): Promise<void> {
  const { getKeyValue, setKeyValue } = await import('../../../lib/keyValueStore');
  const current = getKeyValue<TabsStorage>({
    namespace: 'no_sync',
    key: storageKey,
    fallback: { order: [], activeTabs: {} },
  });
  await setKeyValue({
    namespace: 'no_sync',
    key: storageKey,
    value: {
      ...current,
      activeTabs: { ...current.activeTabs, [activeTabKey]: value },
    },
  });
}
