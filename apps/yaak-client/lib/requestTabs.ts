import { activeRequestIdAtom } from "../hooks/useActiveRequestId";
import { jotaiStore } from "./jotai";
import { getKeyValue, setKeyValue } from "./keyValueStore";
import { setWorkspaceSearchParams } from "./setWorkspaceSearchParams";

/**
 * State for the Postman-style request tab bar. Persisted per-workspace in the
 * `no_sync` key-value namespace so open tabs survive app restarts.
 *
 * `tabs` is the ordered list of open request IDs. `previewTabId` is the single
 * ephemeral "preview" tab (shown in italics) that gets replaced when another
 * request is opened by a single click, à la Postman/VSCode. Editing the request
 * or double-clicking the tab "pins" it by clearing `previewTabId`.
 */
export interface RequestTabsState {
  tabs: string[];
  previewTabId: string | null;
}

export const REQUEST_TABS_NAMESPACE = "no_sync" as const;

export const EMPTY_REQUEST_TABS_STATE: RequestTabsState = { tabs: [], previewTabId: null };

export function requestTabsKey(workspaceId: string): string[] {
  return ["request_tabs", workspaceId];
}

export function getRequestTabsState(workspaceId: string): RequestTabsState {
  return getKeyValue<RequestTabsState>({
    namespace: REQUEST_TABS_NAMESPACE,
    key: requestTabsKey(workspaceId),
    fallback: EMPTY_REQUEST_TABS_STATE,
  });
}

/**
 * Read-modify-write the tab state for a workspace. Reads fresh from the store
 * (rather than a captured React value) so concurrent effects don't clobber each
 * other. No-ops when the reducer returns the same reference.
 */
export async function updateRequestTabsState(
  workspaceId: string,
  reducer: (prev: RequestTabsState) => RequestTabsState,
): Promise<void> {
  const prev = getRequestTabsState(workspaceId);
  const next = reducer(prev);
  if (next === prev) return;
  await setKeyValue({
    namespace: REQUEST_TABS_NAMESPACE,
    key: requestTabsKey(workspaceId),
    value: next,
  });
}

/**
 * Ensure a request is represented as a tab. When `pin` is false (the default for
 * single-click navigation) the request opens as the preview tab, replacing any
 * existing preview in place. When `pin` is true it always becomes a pinned tab.
 */
export function ensureTabReducer(
  state: RequestTabsState,
  id: string,
  pin: boolean,
): RequestTabsState {
  if (state.tabs.includes(id)) {
    if (pin && state.previewTabId === id) {
      return { ...state, previewTabId: null };
    }
    return state;
  }

  if (pin) {
    return { tabs: [...state.tabs, id], previewTabId: state.previewTabId };
  }

  // Open as the preview tab, replacing the existing preview in place
  if (state.previewTabId != null && state.tabs.includes(state.previewTabId)) {
    return {
      tabs: state.tabs.map((t) => (t === state.previewTabId ? id : t)),
      previewTabId: id,
    };
  }

  return { tabs: [...state.tabs, id], previewTabId: id };
}

export function removeTabReducer(state: RequestTabsState, id: string): RequestTabsState {
  if (!state.tabs.includes(id)) return state;
  return {
    tabs: state.tabs.filter((t) => t !== id),
    previewTabId: state.previewTabId === id ? null : state.previewTabId,
  };
}

/** Drop tabs whose request no longer exists (e.g. deleted from the sidebar). */
export function pruneTabsReducer(
  state: RequestTabsState,
  existingIds: Set<string>,
): RequestTabsState {
  const tabs = state.tabs.filter((id) => existingIds.has(id));
  if (tabs.length === state.tabs.length) return state;
  return {
    tabs,
    previewTabId:
      state.previewTabId != null && existingIds.has(state.previewTabId) ? state.previewTabId : null,
  };
}

/** The tab to activate after `id` is closed: prefer the one to the right. */
export function neighborTabId(tabs: string[], id: string): string | null {
  const idx = tabs.indexOf(id);
  if (idx === -1) return null;
  return tabs[idx + 1] ?? tabs[idx - 1] ?? null;
}

/** Navigate to (activate) a request tab. */
export function activateRequestTab(id: string) {
  setWorkspaceSearchParams({ request_id: id, folder_id: null });
}

export async function closeRequestTab(workspaceId: string, id: string): Promise<void> {
  const { tabs } = getRequestTabsState(workspaceId);
  const wasActive = jotaiStore.get(activeRequestIdAtom) === id;
  const neighbor = neighborTabId(tabs, id);

  await updateRequestTabsState(workspaceId, (s) => removeTabReducer(s, id));

  if (wasActive) {
    setWorkspaceSearchParams({ request_id: neighbor, folder_id: null });
  }
}

export async function closeOtherRequestTabs(workspaceId: string, id: string): Promise<void> {
  await updateRequestTabsState(workspaceId, (s) =>
    s.tabs.includes(id) ? { tabs: [id], previewTabId: s.previewTabId === id ? id : null } : s,
  );
  if (jotaiStore.get(activeRequestIdAtom) !== id) {
    setWorkspaceSearchParams({ request_id: id, folder_id: null });
  }
}

export async function closeRequestTabsToRight(workspaceId: string, id: string): Promise<void> {
  const { tabs } = getRequestTabsState(workspaceId);
  const idx = tabs.indexOf(id);
  if (idx === -1) return;
  const keep = new Set(tabs.slice(0, idx + 1));

  await updateRequestTabsState(workspaceId, (s) => ({
    tabs: s.tabs.filter((t) => keep.has(t)),
    previewTabId: s.previewTabId != null && keep.has(s.previewTabId) ? s.previewTabId : null,
  }));

  const activeId = jotaiStore.get(activeRequestIdAtom);
  if (activeId != null && !keep.has(activeId)) {
    setWorkspaceSearchParams({ request_id: id, folder_id: null });
  }
}

export async function closeAllRequestTabs(workspaceId: string): Promise<void> {
  await updateRequestTabsState(workspaceId, () => ({ ...EMPTY_REQUEST_TABS_STATE }));
  setWorkspaceSearchParams({ request_id: null, folder_id: null });
}

/** Pin a preview tab so it stops being ephemeral. */
export async function pinRequestTab(workspaceId: string, id: string): Promise<void> {
  await updateRequestTabsState(workspaceId, (s) =>
    s.previewTabId === id ? { ...s, previewTabId: null } : s,
  );
}

export async function reorderRequestTabs(workspaceId: string, newOrder: string[]): Promise<void> {
  await updateRequestTabsState(workspaceId, (s) => ({ ...s, tabs: newOrder }));
}
