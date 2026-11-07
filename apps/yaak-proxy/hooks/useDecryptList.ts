import { useQueryClient } from "@tanstack/react-query";
import type {
  DecryptList,
  DecryptListChangedPayload,
  DecryptListEntry,
} from "@yaakapp-internal/proxy-lib";
import { useCallback } from "react";
import { useShowToast } from "../lib/toast";
import { useRpcEvent } from "./useRpcEvent";
import { useRpcMutation } from "./useRpcMutation";
import { useRpcQuery } from "./useRpcQuery";

const KEY = ["get_decrypt_list", {}];
const EMPTY: DecryptListEntry[] = [];

/**
 * The decrypt list's entries, empty until read. Kept current as this process changes it, from
 * the app or through its control API.
 */
export function useDecryptList(): DecryptListEntry[] {
  const queryClient = useQueryClient();
  const onChanged = useCallback(
    (payload: DecryptListChangedPayload) =>
      queryClient.setQueryData<DecryptList>(KEY, payload.list),
    [queryClient],
  );
  useRpcEvent("decrypt_list_changed", onChanged);
  return useRpcQuery("get_decrypt_list", {}).data?.entries ?? EMPTY;
}

/**
 * Adds and removes entries, `edit_decrypt_list` applying them to the list as it is when they
 * land, so two changes made in quick succession both stick. Everything that reads the list
 * then reads it again. A failure, such as an entry that does not parse, is a toast.
 */
export function useEditDecryptList() {
  const queryClient = useQueryClient();
  const showToast = useShowToast();
  return useRpcMutation("edit_decrypt_list", {
    // Read again rather than taken from the answer, which can land after a newer change's
    // event and would put the older list back.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
    onError: (e) => showToast({ id: "decrypt-list", color: "danger", message: e.message }),
  });
}
