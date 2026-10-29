import { type ShowToastArgs, showToast } from "@yaakapp-internal/ui";
import { useStore } from "jotai";
import { useCallback } from "react";

/** Shows one of the client's toasts from this app's store, a success unless it says otherwise */
export function useShowToast() {
  const store = useStore();
  return useCallback(
    (toast: ShowToastArgs) => showToast(store, { color: "success", ...toast }),
    [store],
  );
}
