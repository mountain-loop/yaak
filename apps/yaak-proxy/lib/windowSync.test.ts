import { QueryClient } from "@tanstack/react-query";
import { createStore } from "jotai";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const tauri = vi.hoisted(() => ({
  handlers: new Map<string, (payload: unknown) => void>(),
  sent: [] as { event: string; payload: unknown }[],
  label: "main_0",
}));
vi.mock("./tauri", () => ({
  currentWindowLabel: () => tauri.label,
  broadcast: async (event: string, payload: unknown) => {
    tauri.sent.push({ event, payload });
  },
  subscribe: (event: string, handler: (payload: unknown) => void) => {
    tauri.handlers.set(event, handler);
    return () => tauri.handlers.delete(event);
  },
}));
// The store's module reaches for the window as it loads; reading the state again is all this needs
const refreshProxyState = vi.hoisted(() => vi.fn<() => Promise<void>>());
vi.mock("./store", () => ({ refreshProxyState }));

const { announceEngineChange, isSharedStateQuery, syncFromOtherWindows } =
  await import("./windowSync");

describe("windowSync", () => {
  beforeEach(() => {
    tauri.handlers.clear();
    tauri.sent = [];
    tauri.label = "main_0";
    refreshProxyState.mockReset().mockResolvedValue(undefined);
  });

  test("a change is announced as coming from this window", () => {
    tauri.label = "other__settings";
    announceEngineChange();
    expect(tauri.sent).toEqual([{ event: "window_changed_engine", payload: { from: "other__settings" } }]);
  });

  test("a change in another window reads the state and the settings' queries again", () => {
    const store = createStore();
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    syncFromOtherWindows(store, queryClient);

    tauri.handlers.get("window_changed_engine")?.({ from: "other__settings" });

    expect(refreshProxyState).toHaveBeenCalledWith(store);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  test("a window's own change is not read again, as it has been already", () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    syncFromOtherWindows(createStore(), queryClient);

    tauri.handlers.get("window_changed_engine")?.({ from: "main_0" });

    expect(refreshProxyState).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  test("only what settings and setup show is read again, not flows or their bodies", () => {
    for (const cmd of [
      "system_proxy_status",
      "ca_status",
      "get_storage_size",
      "get_decrypt_list",
    ]) {
      expect(isSharedStateQuery([cmd, {}])).toBe(true);
    }
    for (const cmd of ["get_flow_body", "list_flows", "query_schema"]) {
      expect(isSharedStateQuery([cmd, {}])).toBe(false);
    }
  });
});
