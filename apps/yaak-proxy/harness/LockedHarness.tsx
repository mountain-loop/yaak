import { HotkeyProvider } from "@yaakapp-internal/ui";
import type { GetProxyStateResponse } from "@yaakapp-internal/proxy-lib";
import { useStore } from "jotai";
import { type ReactNode, useEffect, useState } from "react";
import { ProxyLayout } from "../components/ProxyLayout";
import { DragRegionCheck } from "./DragRegionCheck";
import { useHotkeyContextValue } from "../lib/hotkeys";
import { syncNavigation, syncSidebarSelection } from "../lib/navigation";
import { syncFlows, syncProxyState } from "../lib/store";

const LOCKED =
  "Traffic is locked: Yaak Proxy stores traffic encrypted and couldn't read its key from the " +
  "keychain: Encryption error: User canceled the operation. Allow it access, then retry.";

const STATE: GetProxyStateResponse = {
  state: "stopped",
  port: null,
  configuredPort: 9090,
  recording: true,
  systemProxyAtLaunch: true,
  httpVersion: "auto",
  startError: LOCKED.slice("Traffic is locked: ".length),
  encrypting: null,
  locked: { message: LOCKED, keychain: true },
  otherOwner: null,
  captureBodyLimit: 10 * 1024 * 1024,
  traffic: "clearOnLaunch",
  keepTrafficBytes: null,
};

/** What the backend answers while the keychain refuses: the state, and every read refused */
function answer(cmd: string): unknown {
  switch (cmd) {
    case "get_proxy_state":
      return STATE;
    case "ca_status":
      return { trusted: true, installed: true, certPath: "/tmp/yaak-proxy-ca.pem" };
    case "system_proxy_status":
      return {
        enabled: false,
        port: 9090,
        services: [],
        backend: "helper",
        helper: "enabled",
        supported: true,
      };
    case "list_actions":
      return { actions: [] };
    default:
      throw new Error(LOCKED);
  }
}

/** Stands in for Tauri's IPC, answering as a locked proxy does */
export function installLockedBackend() {
  const internals = (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> })
    .__TAURI_INTERNALS__;
  internals.invoke = async (cmd: string, args?: { cmd?: string }) => {
    if (cmd === "rpc") return answer(args?.cmd ?? "");
    if (cmd.startsWith("plugin:event|")) return 0;
    throw new Error(`Not in the harness: ${cmd}`);
  };
  (
    window as unknown as { __TAURI_OS_PLUGIN_INTERNALS__: Record<string, string> }
  ).__TAURI_OS_PLUGIN_INTERNALS__ = {
    os_type: "macos",
    platform: "macos",
    family: "unix",
    version: "15.0",
    eol: "\n",
  };
  // Setup was done before, as for anyone whose traffic is locked after an upgrade.
  localStorage.setItem("system_proxy_ever_on", "true");
}

/**
 * The whole window, as the app renders it: while captured traffic is locked, or over the
 * fixture backend with `?window`
 */
export function LockedHarness() {
  const store = useStore();
  const [synced, setSynced] = useState(false);
  useEffect(() => {
    syncProxyState(store);
    void syncNavigation(store).then(() => {
      syncFlows(store);
      syncSidebarSelection(store);
      setSynced(true);
    });
  }, [store]);
  if (!synced) return null;
  return (
    <Hotkeys>
      <ProxyLayout />
      {new URLSearchParams(location.search).has("dragcheck") && <DragRegionCheck />}
    </Hotkeys>
  );
}

function Hotkeys({ children }: { children: ReactNode }) {
  return <HotkeyProvider value={useHotkeyContextValue()}>{children}</HotkeyProvider>;
}
