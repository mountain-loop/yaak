import type { DragEndEvent, DragMoveEvent, DragStartEvent } from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import classNames from "classnames";
import type { CSSProperties, ReactNode, Ref } from "react";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useKeyValue } from "../../../hooks/useKeyValue";
import { computeSideForDragMove, DropMarker } from "@yaakapp-internal/ui";
import { fireAndForget } from "../../../lib/fireAndForget";
import { ErrorBoundary } from "../../ErrorBoundary";
import type { ButtonProps } from "../Button";
import { Button } from "../Button";
import { Dropdown } from "../Dropdown";
import { IconButton } from "../IconButton";
import { Icon } from "@yaakapp-internal/ui";
import type { RadioDropdownProps } from "../RadioDropdown";
import { RadioDropdown } from "../RadioDropdown";
import { useFittingTabs } from "./useFittingTabs";
import { MIN_TAB_GAP_SCALE, MIN_TAB_PADDING_SCALE } from "./fitTabs";

export type TabItem = {
  /** Stable label for the visibility menu, including tabs with dropdown labels. */
  menuLabel?: string;
  hiddenByDefault?: boolean;
} & (
  | {
      value: string;
      label: string;
      hidden?: boolean;
      leftSlot?: ReactNode;
      rightSlot?: ReactNode;
    }
  | {
      value: string;
      options: Omit<RadioDropdownProps, "children">;
      leftSlot?: ReactNode;
      rightSlot?: ReactNode;
    }
);

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
  layout?: "horizontal" | "vertical";
  /** Storage key for persisting tab order and active tab. When provided, enables drag-to-reorder and active tab persistence. */
  storageKey?: string | string[];
  /** Key to identify which context this tab belongs to (e.g., request ID). Used for per-context active tab persistence. */
  activeTabKey?: string;
  /** Enables show/hide controls, scoped independently of tab order and selection. */
  visibilityStorageKey?: string | string[];
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
    layout = "vertical",
    storageKey,
    activeTabKey,
    visibilityStorageKey,
  }: Props,
  forwardedRef: Ref<TabsRef>,
) {
  const ref = useRef<HTMLDivElement | null>(null);
  const reorderable = !!storageKey;

  // Use key-value storage for persistence if storageKey is provided
  // Handle migration from old format (string[]) to new format (TabsStorage)
  const { value: rawStorage, set: setStorage } = useKeyValue<TabsStorage | string[]>({
    namespace: "no_sync",
    key: storageKey ?? ["tabs", "default"],
    fallback: { order: [], activeTabs: {} },
  });

  // Migrate old format (string[]) to new format (TabsStorage)
  const storage: TabsStorage = Array.isArray(rawStorage)
    ? { order: rawStorage, activeTabs: {} }
    : (rawStorage ?? { order: [], activeTabs: {} });

  const savedOrder = storage.order;

  const visibilityKey = visibilityStorageKey ?? ["tabs", "default_visibility"];
  const { value: visibility, set: setVisibility } = useKeyValue<Record<string, boolean>>({
    namespace: "no_sync",
    key: visibilityKey,
    fallback: {},
  });
  const { value: wrapPreference, set: setWrapPreference } = useKeyValue<boolean>({
    namespace: "no_sync",
    key: [...(Array.isArray(visibilityKey) ? visibilityKey : [visibilityKey]), "wrap"],
    fallback: false,
  });
  const isVisible = useCallback(
    (tab: TabItem) =>
      !("hidden" in tab && tab.hidden) &&
      (!visibilityStorageKey || (visibility?.[tab.value] ?? !tab.hiddenByDefault)),
    [visibility, visibilityStorageKey],
  );

  // Get the active tab value - prefer storage (if activeTabKey), then defaultValue, then first tab
  const storedActiveTab = activeTabKey ? storage?.activeTabs?.[activeTabKey] : undefined;
  const [internalValue, setInternalValue] = useState<string | undefined>(undefined);
  const requestedValue = storedActiveTab ?? internalValue ?? defaultValue ?? originalTabs[0]?.value;
  // Dynamic tabs can disappear when switching responses or other contexts.
  // Keep the saved preference, but display an available tab until it returns.
  const value = originalTabs.some((t) => t.value === requestedValue && isVisible(t))
    ? requestedValue
    : originalTabs.find(isVisible)?.value;

  // Helper to normalize storage (handle migration from old format)
  const normalizeStorage = useCallback(
    (s: TabsStorage | string[]): TabsStorage =>
      Array.isArray(s) ? { order: s, activeTabs: {} } : s,
    [],
  );

  // Handle tab change - update internal state, storage if we have a key, and call prop callback
  const onChangeValue = useCallback(
    async (newValue: string) => {
      if (visibilityStorageKey) {
        await setVisibility((s) => ({ ...s, [newValue]: true }));
      }
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
    [
      storageKey,
      activeTabKey,
      setStorage,
      onChangeValueProp,
      normalizeStorage,
      visibilityStorageKey,
      setVisibility,
    ],
  );

  // Expose imperative methods via ref
  useImperativeHandle(
    forwardedRef,
    () => ({
      setActiveTab: (value: string) => {
        fireAndForget(onChangeValue(value));
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
  const responsive = !!visibilityStorageKey && layout === "vertical";
  const wrapTabs = responsive && !!wrapPreference;
  const { viewportRef, measurementsRef, fittedTabs } = useFittingTabs(
    responsive && !wrapTabs,
    value,
  );
  const fitsInStrip = useCallback(
    (tab: TabItem) =>
      isVisible(tab) && (fittedTabs == null || fittedTabs.some((t) => t.value === tab.value)),
    [isVisible, fittedTabs],
  );
  const overflowTabs = tabs.filter((tab) => isVisible(tab) && !fitsInStrip(tab));

  // Update tabs when value changes
  useEffect(() => {
    const tabs = ref.current?.querySelectorAll<HTMLDivElement>("[data-tab]");
    for (const tab of tabs ?? []) {
      const v = tab.getAttribute("data-tab");
      const parent = tab.closest(".tabs-container");
      if (parent !== ref.current) {
        // Tab is part of a nested tab container, so ignore it
      } else if (v === value) {
        tab.setAttribute("data-state", "active");
        tab.setAttribute("aria-hidden", "false");
        tab.style.display = "block";
      } else {
        tab.setAttribute("data-state", "inactive");
        tab.setAttribute("aria-hidden", "true");
        tab.style.display = "none";
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
      const orientation = layout === "vertical" ? "horizontal" : "vertical";
      const side = computeSideForDragMove(overTab.value, e, orientation);

      // If computeSideForDragMove returns null (shouldn't happen but be safe), default to null
      if (side === null) return setHoveredIndex(null);

      const overIndex = tabs.findIndex((t) => t.value === overId);
      const hoveredIndex = overIndex + (side === "before" ? 0 : 1);

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
      if (!fitsInStrip(t)) {
        return;
      }

      const next = tabs[i + 1];
      const fitted = fittedTabs?.find((tab) => tab.value === t.value);
      items.push(
        <TabButton
          key={t.value}
          tab={t}
          isActive={t.value === value}
          addBorders={addBorders}
          layout={layout}
          reorderable={reorderable}
          isDragging={isDragging?.value === t.value}
          onChangeValue={onChangeValue}
          width={fitted?.width}
          spacingCompression={fitted?.spacingCompression}
          wrap={wrapTabs}
          dropBefore={hoveredIndex === i}
          // A drop after the last fitted tab still inserts into the full saved order.
          dropAfter={hoveredIndex === i + 1 && (!next || !fitsInStrip(next))}
        />,
      );
    });
    return items;
  }, [
    tabs,
    value,
    addBorders,
    layout,
    reorderable,
    isDragging,
    onChangeValue,
    hoveredIndex,
    fitsInStrip,
    fittedTabs,
    wrapTabs,
  ]);

  const tabStrip = (
    <div
      ref={viewportRef}
      role="tablist"
      aria-label={label}
      className={classNames(
        !visibilityStorageKey && tabListClassName,
        addBorders && layout === "horizontal" && "pl-3 -ml-1",
        addBorders && layout === "vertical" && "ml-0 mb-2",
        "flex items-center hide-scrollbars",
        layout === "horizontal" && "h-full overflow-auto p-2",
        layout === "vertical" &&
          (responsive ? "relative overflow-hidden py-1" : "overflow-x-auto overflow-y-visible"),
        // Give space for button focus states within overflow boundary.
        !responsive && !addBorders && layout === "vertical" && "py-1 pl-3 -ml-5 pr-1",
      )}
    >
      <div
        className={classNames(
          layout === "horizontal" && "flex flex-col w-full pb-3 mb-auto",
          layout === "vertical" && "flex flex-row shrink-0 w-full",
          wrapTabs && "flex-wrap gap-y-1",
        )}
      >
        {tabButtons}
      </div>
      {responsive && !wrapTabs && (
        <div
          ref={measurementsRef}
          aria-hidden
          inert
          className="absolute invisible pointer-events-none flex w-max"
        >
          {tabs.filter(isVisible).map((tab) => (
            <div key={tab.value} data-measure-tab={tab.value} className="flex shrink-0">
              <TabButton
                tab={tab}
                isActive={tab.value === value}
                addBorders={addBorders}
                layout={layout}
                reorderable={false}
                isDragging={false}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // Keep the menu outside the scroll viewport so tabs cannot paint behind or past it.
  const tabList = visibilityStorageKey ? (
    <div
      className={classNames(
        tabListClassName,
        "flex shrink-0 min-w-0 min-h-0",
        layout === "vertical" ? "items-start" : "flex-col",
      )}
    >
      <div className="min-w-0 min-h-0 flex-1">{tabStrip}</div>
      <div
        className={classNames(
          "shrink-0 pl-1",
          layout === "vertical" && "flex items-center h-md my-1",
        )}
      >
        <Dropdown
          items={[
            ...(overflowTabs.length > 0
              ? [
                  { type: "separator" as const, label: "More tabs" },
                  ...overflowTabs.map((tab) => ({
                    label: tab.menuLabel ?? ("label" in tab ? tab.label : tab.value),
                    icon: tab.value === value ? ("check" as const) : ("empty" as const),
                    rightSlot: tab.rightSlot,
                    onSelect: () => onChangeValue(tab.value),
                  })),
                  { type: "separator" as const },
                ]
              : []),
            {
              label: "Show tabs",
              submenu: [
                { type: "separator", label: "In this workspace" },
                ...tabs
                  .filter((t) => !("hidden" in t && t.hidden))
                  .map((tab) => ({
                    label: tab.menuLabel ?? ("label" in tab ? tab.label : tab.value),
                    icon: isVisible(tab)
                      ? ("check_square_checked" as const)
                      : ("check_square_unchecked" as const),
                    disabled: isVisible(tab) && tabs.filter(isVisible).length <= 1,
                    keepOpenOnSelect: true,
                    onSelect: async () => {
                      if (!isVisible(tab)) {
                        await onChangeValue(tab.value);
                      } else {
                        if (tab.value === value) {
                          const next = tabs.find((t) => t.value !== tab.value && isVisible(t));
                          if (next) await onChangeValue(next.value);
                        }
                        await setVisibility((s) => ({ ...s, [tab.value]: false }));
                      }
                    },
                  })),
              ],
            },
            {
              label: "Wrap tabs",
              hidden: layout !== "vertical",
              icon: wrapTabs ? "check_square_checked" : "check_square_unchecked",
              keepOpenOnSelect: true,
              onSelect: () => setWrapPreference((wrap) => !wrap),
            },
          ]}
        >
          <IconButton icon="ellipsis" title="More tabs and visibility" size="sm" />
        </Dropdown>
      </div>
    </div>
  ) : (
    tabStrip
  );

  return (
    <div
      ref={ref}
      className={classNames(
        className,
        "tabs-container",
        "h-full",
        // Size wrapped rows at the resolved pane width instead of using an intrinsic grid track.
        responsive
          ? "flex flex-col min-h-0 [&>.tab-content]:flex-1 [&>.tab-content]:min-h-0"
          : "grid",
        layout === "horizontal" && "grid-rows-1 grid-cols-[auto_minmax(0,1fr)]",
        !responsive && layout === "vertical" && "grid-rows-[auto_minmax(0,1fr)] grid-cols-1",
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
  layout: "horizontal" | "vertical";
  reorderable: boolean;
  isDragging: boolean;
  onChangeValue?: (value: string) => void;
  overlay?: boolean;
  width?: number;
  spacingCompression?: number;
  wrap?: boolean;
  dropBefore?: boolean;
  dropAfter?: boolean;
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
  width,
  spacingCompression = 0,
  wrap = false,
  dropBefore = false,
  dropAfter = false,
}: TabButtonProps) {
  const constrained = width !== undefined;
  const btnProps: Partial<ButtonProps> = {
    color: "custom",
    justify: layout === "horizontal" ? "start" : "center",
    innerClassName: classNames(
      "tab-button-label",
      constrained && "w-auto! shrink-0 overflow-visible! text-clip!",
      wrap && "whitespace-normal! overflow-visible! text-clip! [overflow-wrap:anywhere]",
    ),
    style: constrained
      ? {
          paddingInline: `calc(var(--spacing) * ${2 * (1 - spacingCompression * (1 - MIN_TAB_PADDING_SCALE))})`,
        }
      : undefined,
    onClick: isActive
      ? undefined
      : (e: React.MouseEvent) => {
          e.preventDefault(); // Prevent dropdown from opening on first click
          onChangeValue?.(tab.value);
        },
    className: classNames(
      "flex items-center rounded-sm whitespace-nowrap",
      "ml-px",
      !constrained && "px-2!",
      "outline-hidden",
      "ring-none",
      "focus-visible-or-class:outline-2",
      addBorders && "border focus-visible:bg-surface-highlight",
      isActive ? "text-text" : "text-text-subtle",
      isActive && addBorders
        ? "border-surface-active bg-surface-active"
        : layout === "vertical"
          ? "border-border-subtle"
          : "border-transparent",
      layout === "horizontal" && "min-w-40",
      isDragging && "opacity-50",
      overlay && "opacity-80",
      constrained && "w-[calc(100%_-_1px)]",
      wrap && "max-w-[calc(100%_-_1px)]! h-auto! min-h-md",
      (constrained || wrap) && "[&>div:not(.tab-button-label)]:shrink-0",
    ),
  };

  const buttonContent = (() => {
    if ("options" in tab) {
      const option = tab.options.items.find((i) => "value" in i && i.value === tab.options.value);
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
            title={
              (constrained || wrap) && typeof option?.label === "string" ? option.label : undefined
            }
            leftSlot={tab.leftSlot}
            rightSlot={
              <div className="flex items-center">
                {tab.rightSlot}
                <Icon
                  size="sm"
                  icon="chevron_down"
                  className={classNames(
                    "ml-1",
                    isActive ? "text-text-subtle" : "text-text-subtlest",
                  )}
                />
              </div>
            }
            {...btnProps}
          >
            {option && "shortLabel" in option && option.shortLabel
              ? option.shortLabel
              : (option?.label ?? "Unknown")}
          </Button>
        </RadioDropdown>
      );
    }
    return (
      <Button
        title={(constrained || wrap) && "label" in tab ? tab.label : undefined}
        leftSlot={tab.leftSlot}
        rightSlot={tab.rightSlot}
        {...btnProps}
      >
        {"label" in tab && tab.label ? tab.label : tab.value}
      </Button>
    );
  })();

  const wrapperClassName = classNames(
    "relative shrink-0",
    layout === "vertical" && (constrained ? "min-w-0" : "mr-2"),
    wrap && "min-w-0 max-w-[calc(100%_-_0.5rem)]",
  );
  const wrapperStyle: CSSProperties = {
    width,
    paddingRight: constrained
      ? `calc(var(--spacing) * ${2 * (1 - spacingCompression * (1 - MIN_TAB_GAP_SCALE))})`
      : undefined,
  };
  // Anchor markers to their tabs so they follow the tab when it wraps onto another row.
  const content = (
    <>
      {dropBefore && (
        <DropMarker
          key="before"
          orientation={layout === "vertical" ? "vertical" : "horizontal"}
          className={layout === "vertical" ? "left-0" : "top-0"}
        />
      )}
      {buttonContent}
      {dropAfter && (
        <DropMarker
          key="after"
          orientation={layout === "vertical" ? "vertical" : "horizontal"}
          className={layout === "vertical" ? "right-0" : "bottom-0"}
        />
      )}
    </>
  );
  return reorderable && !overlay ? (
    <DraggableTab value={tab.value} className={wrapperClassName} style={wrapperStyle}>
      {content}
    </DraggableTab>
  ) : (
    <div className={wrapperClassName} style={wrapperStyle}>
      {content}
    </div>
  );
}

// Measurement copies and drag overlays must not register duplicate draggable IDs.
function DraggableTab({
  value,
  className,
  style,
  children,
}: {
  value: string;
  className: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
  } = useDraggable({
    id: value,
    attributes: { tabIndex: -1 },
  });
  const { setNodeRef: setDroppableRef } = useDroppable({ id: value });
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      setDraggableRef(node);
      setDroppableRef(node);
    },
    [setDraggableRef, setDroppableRef],
  );

  return (
    <div ref={setRef} className={className} style={style} {...attributes} {...listeners}>
      {children}
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
        className={classNames(className, "tab-content", "hidden w-full h-full pt-2")}
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
  const { getKeyValue, setKeyValue } = await import("../../../lib/keyValueStore");
  const current = getKeyValue<TabsStorage>({
    namespace: "no_sync",
    key: storageKey,
    fallback: { order: [], activeTabs: {} },
  });
  await setKeyValue({
    namespace: "no_sync",
    key: storageKey,
    value: {
      ...current,
      activeTabs: { ...current.activeTabs, [activeTabKey]: value },
    },
  });
}
