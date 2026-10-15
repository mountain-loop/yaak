import {
  Icon,
  type StoredValue,
  TabContent as BaseTabContent,
  type TabContentProps,
  type TabItem as BaseTabItem,
  Tabs as BaseTabs,
  type TabsProps as BaseTabsProps,
  type TabsRef,
  type TabsStorage,
} from "@yaakapp-internal/ui";
import classNames from "classnames";
import type { ReactNode } from "react";
import { forwardRef, memo, useMemo } from "react";
import { useKeyValue } from "../../../hooks/useKeyValue";
import { ErrorBoundary } from "../../ErrorBoundary";
import { Button } from "../Button";
import type { RadioDropdownProps } from "../RadioDropdown";
import { RadioDropdown } from "../RadioDropdown";

export type { TabsRef };

export type TabItem =
  | Extract<BaseTabItem, { label: string }>
  | {
      value: string;
      options: Omit<RadioDropdownProps, "children">;
      leftSlot?: ReactNode;
      rightSlot?: ReactNode;
    };

type Props = Omit<BaseTabsProps, "tabs" | "useStoredValue"> & { tabs: TabItem[] };

export const Tabs = forwardRef<TabsRef, Props>(function Tabs({ tabs, ...props }, ref) {
  const baseTabs = useMemo(() => tabs.map(toBaseTab), [tabs]);
  return <BaseTabs ref={ref} tabs={baseTabs} useStoredValue={useTabsStoredValue} {...props} />;
});

export const TabContent = memo(function TabContent(props: Omit<TabContentProps, "ErrorBoundary">) {
  return <BaseTabContent {...props} ErrorBoundary={ErrorBoundary} />;
});

function toBaseTab(tab: TabItem): BaseTabItem {
  if (!("options" in tab)) return tab;
  const { options } = tab;
  return {
    value: tab.value,
    leftSlot: tab.leftSlot,
    rightSlot: tab.rightSlot,
    renderButton: ({ buttonProps, isActive }) => {
      const option = options.items.find((i) => "value" in i && i.value === options.value);
      return (
        <RadioDropdown
          key={tab.value}
          items={options.items}
          itemsAfter={options.itemsAfter}
          itemsBefore={options.itemsBefore}
          value={options.value}
          onChange={options.onChange}
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
                    "ml-1",
                    isActive ? "text-text-subtle" : "text-text-subtlest",
                  )}
                />
              </div>
            }
            {...buttonProps}
          >
            {option && "shortLabel" in option && option.shortLabel
              ? option.shortLabel
              : (option?.label ?? "Unknown")}
          </Button>
        </RadioDropdown>
      );
    },
  };
}

function useTabsStoredValue<T extends StoredValue>(key: string | string[] | null, fallback: T) {
  const { value, set } = useKeyValue<T>({
    namespace: "no_sync",
    key: key ?? ["tabs", "default"],
    fallback,
  });
  return [value ?? fallback, set] as const;
}

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
