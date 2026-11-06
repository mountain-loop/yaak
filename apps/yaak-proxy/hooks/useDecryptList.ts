import { useQueryClient } from "@tanstack/react-query";
import type { DecryptList, DecryptListEntry } from "@yaakapp-internal/proxy-lib";
import { useShowToast } from "../lib/toast";
import { useRpcMutation } from "./useRpcMutation";
import { useRpcQuery } from "./useRpcQuery";

const KEY = ["get_decrypt_list", {}];
const EMPTY: DecryptListEntry[] = [];

/** The decrypt list's entries, empty until read */
export function useDecryptList(): DecryptListEntry[] {
  return useRpcQuery("get_decrypt_list", {}).data?.entries ?? EMPTY;
}

/**
 * Saves the whole list, `set_decrypt_list` normalizing each entry, and shows what was saved
 * everywhere that reads it. A failure, such as an entry that does not parse, is a toast.
 */
export function useSetDecryptList() {
  const queryClient = useQueryClient();
  const showToast = useShowToast();
  return useRpcMutation("set_decrypt_list", {
    onSuccess: (list) => queryClient.setQueryData<DecryptList>(KEY, list),
    onError: (e) => showToast({ id: "decrypt-list", color: "danger", message: e.message }),
  });
}
