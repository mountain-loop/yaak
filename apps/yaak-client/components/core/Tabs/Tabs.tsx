import {
  TabContent as BaseTabContent,
  type TabContentProps,
  type TabItem,
  Tabs as BaseTabs,
  type TabsProps,
  type TabsRef,
  type TabsStorage,
} from "@yaakapp-internal/ui";
import { forwardRef, memo } from "react";
import { ErrorBoundary } from "../../ErrorBoundary";

export type { TabItem, TabsRef };

// The client's EditorHostProvider keeps tab order and the active tab in its key-value store
export const Tabs = forwardRef<TabsRef, Omit<TabsProps, "useStoredValue">>(
  function Tabs(props, ref) {
    return <BaseTabs ref={ref} {...props} />;
  },
);

export const TabContent = memo(function TabContent(props: Omit<TabContentProps, "ErrorBoundary">) {
  return <BaseTabContent {...props} ErrorBoundary={ErrorBoundary} />;
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
