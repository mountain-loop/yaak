import { useIsMutating, useQueryClient } from "@tanstack/react-query";
import type { CaStatus, PassthroughResponse } from "@yaakapp-internal/proxy-lib";
import { Button } from "@yaakapp-internal/ui";
import { useCallback } from "react";
import { inverseEdit } from "../lib/decrypt";
import {
  applyChoice,
  choiceToast,
  type DecryptChoice,
  type ListEdit,
  reconnectEntries,
} from "../lib/decryptChoice";
import { rpc } from "../lib/rpc";
import { getOsType } from "../lib/tauri";
import { useShowToast } from "../lib/toast";
import { announceEngineChange } from "../lib/windowSync";
import { useRpcEvent } from "./useRpcEvent";
import { useRpcMutation } from "./useRpcMutation";
import { useRpcQuery } from "./useRpcQuery";

const CA_KEY = ["ca_status", {}];
const LIST_KEY = ["get_decrypt_list", {}];
const PASSTHROUGH_KEY = ["list_passthrough", {}];
const TRUST_KEY = ["ca_trust"];

/** The app trusts its certificate itself only on macOS; elsewhere it is installed by hand */
export function canTrustHere(): boolean {
  return getOsType() === "macos";
}

/** Whether macOS's password prompt is up, from any control that asked for it */
export function useTrusting(): boolean {
  return useIsMutating({ mutationKey: TRUST_KEY }) > 0;
}

/** Asks macOS to trust the certificate, the status read from its answer */
export function useTrustCertificate() {
  const queryClient = useQueryClient();
  const showToast = useShowToast();
  return useRpcMutation("ca_trust", {
    mutationKey: TRUST_KEY,
    onSuccess: ({ trusted, installed, certPath }) =>
      queryClient.setQueryData<CaStatus>(CA_KEY, { trusted, installed, certPath }),
    // A cancelled prompt isn't an error, and says nothing; a failure says why.
    onError: (err) =>
      showToast({
        id: "decrypt",
        color: "danger",
        message: `Failed to trust certificate: ${err.message}`,
      }),
  });
}

/**
 * Every Decrypt and Stop Decrypting in the app: trusts the certificate first when the change can
 * decrypt something and it isn't yet (macOS's password prompt), then writes the change, then a
 * toast with Undo, and with Reconnect while open connections the list now decrypts stay
 * encrypted. A cancelled prompt changes nothing and says nothing.
 */
export function useDecrypt() {
  const queryClient = useQueryClient();
  const showToast = useShowToast();
  const trusting = useTrusting();
  const { mutateAsync: trust } = useTrustCertificate();

  const run = useCallback(
    async (edit: ListEdit) => {
      try {
        return await applyChoice(
          {
            canTrust: canTrustHere(),
            readTrusted: async () => {
              const status = await rpc("ca_status", {});
              queryClient.setQueryData<CaStatus>(CA_KEY, status);
              return status.trusted;
            },
            trust: () => trust({}),
            save: async (edit) => {
              try {
                return await rpc("edit_decrypt_list", edit);
              } finally {
                // Read again rather than taken from the answer, which can land after a newer
                // change's event and would put the older list back.
                void queryClient.invalidateQueries({ queryKey: LIST_KEY });
                announceEngineChange();
              }
            },
          },
          edit,
        );
      } catch (err) {
        showToast({
          id: "decrypt",
          color: "danger",
          message: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    },
    [queryClient, showToast, trust],
  );

  const reconnect = useCallback(
    (entries: string[]) => {
      for (const entry of entries) {
        rpc("reconnect_tunnels", { entry }).catch((err) =>
          showToast({ id: "reconnect", color: "danger", message: String(err) }),
        );
      }
    },
    [showToast],
  );

  /** Applies a choice; true once it is written */
  const apply = useCallback(
    async (choice: DecryptChoice): Promise<boolean> => {
      const result = await run(choice.edit);
      if (result == null || result.status === "cancelled") return false;
      if (result.status === "untrusted") {
        showToast({
          id: "decrypt",
          color: "warning",
          message: "Certificate not trusted",
        });
        return false;
      }
      // Counted within what Reconnect closes, not every open connection the list now decrypts
      const scoped =
        result.stillEncrypted > 0 ? await countReconnectable(reconnectEntries(choice.edit)) : 0;
      const toast = choiceToast(choice, scoped);
      showToast({
        id: "decrypt",
        message: (
          <div>
            <div>{toast.message}</div>
            {toast.sub != null && (
              <div className="text-xs text-text-subtle mt-0.5">{toast.sub}</div>
            )}
          </div>
        ),
        action: ({ hide }) => (
          <div className="flex gap-2">
            <Button
              size="xs"
              variant="border"
              onClick={() => {
                hide();
                void run(inverseEdit(choice.edit));
              }}
            >
              Undo
            </Button>
            {toast.reconnect.length > 0 && (
              <Button
                size="xs"
                variant="border"
                onClick={() => {
                  hide();
                  reconnect(toast.reconnect);
                }}
              >
                Reconnect
              </Button>
            )}
          </div>
        ),
      });
      return true;
    },
    [run, reconnect, showToast],
  );

  return { apply, trusting };
}

/** Open tunnels the entries name that the list now decrypts, each counted once */
async function countReconnectable(entries: string[]): Promise<number> {
  const ids = new Set<string>();
  for (const entry of entries) {
    try {
      for (const t of await rpc("list_reconnectable_tunnels", { entry })) ids.add(t.id);
    } catch (err) {
      console.warn("Failed to list reconnectable tunnels", err);
    }
  }
  return ids.size;
}

/**
 * The addresses passed through after clients rejected the certificate, kept current as the
 * engine adds and forgets them. Null until read.
 */
export function usePassthrough(): string[] | null {
  const queryClient = useQueryClient();
  const onChanged = useCallback(
    (payload: PassthroughResponse) =>
      queryClient.setQueryData<PassthroughResponse>(PASSTHROUGH_KEY, payload),
    [queryClient],
  );
  useRpcEvent("passthrough_changed", onChanged);
  return useRpcQuery("list_passthrough", {}).data?.addresses ?? null;
}
