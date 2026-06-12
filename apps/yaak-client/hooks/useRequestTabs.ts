import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import {
  EMPTY_REQUEST_TABS_STATE,
  ensureTabReducer,
  pruneTabsReducer,
  REQUEST_TABS_NAMESPACE,
  requestTabsKey,
  type RequestTabsState,
  updateRequestTabsState,
} from "../lib/requestTabs";
import { activeRequestIdAtom } from "./useActiveRequestId";
import { activeWorkspaceIdAtom } from "./useActiveWorkspace";
import { allRequestsAtom } from "./useAllRequests";
import { useKeyValue } from "./useKeyValue";

function useRequestTabsKeyValue() {
  const workspaceId = useAtomValue(activeWorkspaceIdAtom);
  return useKeyValue<RequestTabsState>({
    namespace: REQUEST_TABS_NAMESPACE,
    key: requestTabsKey(workspaceId ?? "n/a"),
    fallback: EMPTY_REQUEST_TABS_STATE,
  });
}

/** Reactive read of the current workspace's request tab state. */
export function useRequestTabsState(): RequestTabsState {
  const { value } = useRequestTabsKeyValue();
  return value ?? EMPTY_REQUEST_TABS_STATE;
}

/**
 * Keeps the request tab bar in sync with navigation. Mounted once in the
 * Workspace. Responsibilities:
 *  - Open the active request as a preview tab whenever it changes (covers every
 *    navigation source: sidebar, command palette, recent dropdown, create, …).
 *  - Prune tabs whose request was deleted.
 *  - Pin the preview tab the first time its request is edited.
 */
export function useSubscribeRequestTabs() {
  const workspaceId = useAtomValue(activeWorkspaceIdAtom);
  const activeRequestId = useAtomValue(activeRequestIdAtom);
  const allRequests = useAtomValue(allRequestsAtom);
  const { value } = useRequestTabsKeyValue();
  const previewTabId = value?.previewTabId ?? null;

  // Ensure the active request is represented as its own persistent tab so that
  // opening multiple requests accumulates tabs side-by-side.
  useEffect(() => {
    if (workspaceId == null || activeRequestId == null) return;
    void updateRequestTabsState(workspaceId, (s) => ensureTabReducer(s, activeRequestId, true));
  }, [workspaceId, activeRequestId]);

  // Drop tabs for requests that no longer exist
  useEffect(() => {
    if (workspaceId == null) return;
    const existing = new Set(allRequests.map((r) => r.id));
    void updateRequestTabsState(workspaceId, (s) => pruneTabsReducer(s, existing));
  }, [workspaceId, allRequests]);

  // Pin the preview tab once its request is edited (updatedAt changes)
  const baselineRef = useRef<{ id: string; updatedAt: string } | null>(null);
  useEffect(() => {
    if (previewTabId == null) {
      baselineRef.current = null;
      return;
    }
    const req = allRequests.find((r) => r.id === previewTabId);
    if (req == null) return;

    // First time we see this preview: record its baseline, don't pin
    if (baselineRef.current?.id !== previewTabId) {
      baselineRef.current = { id: previewTabId, updatedAt: req.updatedAt };
      return;
    }

    if (baselineRef.current.updatedAt !== req.updatedAt) {
      baselineRef.current = null;
      if (workspaceId != null) {
        void updateRequestTabsState(workspaceId, (s) =>
          s.previewTabId === previewTabId ? { ...s, previewTabId: null } : s,
        );
      }
    }
  }, [workspaceId, allRequests, previewTabId]);
}
