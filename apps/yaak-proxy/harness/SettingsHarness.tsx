import { useStore } from "jotai";
import { useEffect, useState } from "react";
import { SETTINGS_TAB_PROXY, SettingsContent } from "../components/Settings";
import { syncProxyState } from "../lib/store";

/**
 * Dev only: the settings window over the fixture backend, at the dialog's size. Open
 * `/harness.html?settings&theme=dark`; `&tab=general` opens another tab than Proxy.
 */
export function SettingsHarness() {
  const store = useStore();
  const [synced, setSynced] = useState(false);
  useEffect(() => {
    syncProxyState(store);
    setSynced(true);
  }, [store]);
  const tab = new URLSearchParams(location.search).get("tab") ?? SETTINGS_TAB_PROXY;
  if (!synced) return null;
  return (
    <div className="h-full w-full grid place-items-center bg-surface-highlight p-6">
      <div className="h-full w-[min(56rem,100%)] bg-surface rounded-lg border border-border-subtle overflow-hidden">
        <SettingsContent defaultTab={tab} />
      </div>
    </div>
  );
}
