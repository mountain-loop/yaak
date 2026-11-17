import { useQueryClient } from "@tanstack/react-query";
import type {
  DecryptList,
  DecryptListChangedPayload,
  DecryptListEntry,
} from "@yaakapp-internal/proxy-lib";
import { useCallback } from "react";
import { useRpcEvent } from "./useRpcEvent";
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
