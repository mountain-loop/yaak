import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { createStore } from "jotai";
import { refreshProxyState } from "./store";
import { broadcast, currentWindowLabel, subscribe } from "./tauri";

type Store = ReturnType<typeof createStore>;

/** Sent after a change made through the engine, so the app's other windows read again */
const ENGINE_CHANGED_EVENT = "window_changed_engine";

interface EngineChanged {
  /** The window the change was made in, which has read again already */
  from: string;
}

/**
 * The queries a change in another window can leave stale: what Settings sets, and the system
 * proxy and certificate state the header and Settings both show. Flows and their bodies have
 * events of their own, and reading them again would cost far more.
 */
const SHARED_STATE_QUERIES = new Set([
  "system_proxy_status",
  "ca_status",
  "get_storage_size",
  "get_decrypt_list",
  "list_seen",
]);

export function isSharedStateQuery(queryKey: QueryKey): boolean {
  return SHARED_STATE_QUERIES.has(String(queryKey[0]));
}

/** Tells the app's other windows a change was made here, such as a setting */
export function announceEngineChange() {
  broadcast(ENGINE_CHANGED_EVENT, { from: currentWindowLabel() } satisfies EngineChanged).catch(
    (err) => console.warn("Failed to tell the other windows of a change", err),
  );
}

/**
 * Reads the engine's state and the shared queries again when another window changes them, as
 * that window does itself, so a setting changed in Settings shows in the main window at once.
 */
export function syncFromOtherWindows(store: Store, queryClient: QueryClient) {
  const here = currentWindowLabel();
  subscribe<EngineChanged>(ENGINE_CHANGED_EVENT, ({ from }) => {
    if (from === here) return;
    refreshProxyState(store).catch((err) => console.warn("Failed to read the proxy state", err));
    void queryClient.invalidateQueries({ predicate: (q) => isSharedStateQuery(q.queryKey) });
  });
}
