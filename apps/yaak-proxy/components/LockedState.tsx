import type { ProxyLock } from "@yaakapp-internal/proxy-lib";
import { Button, Icon, LoadingIcon } from "@yaakapp-internal/ui";
import { useAtomValue } from "jotai";
import { useRpcMutation } from "../hooks/useRpcMutation";
import { encryptingPercent } from "../lib/encrypting";
import { lockedLine } from "../lib/locked";
import { proxyStateAtom } from "../lib/store";
import { getOsType } from "../lib/tauri";

/**
 * Over the list and the detail pane while captured traffic can't be read: its key is
 * unavailable, or traffic from before encryption is being encrypted. Retry reads the key again
 * and opens it.
 */
export function LockedState({ lock }: { lock: ProxyLock }) {
  const proxyState = useAtomValue(proxyStateAtom);
  const retry = useRpcMutation("take_over");
  const encrypting = encryptingPercent(proxyState);

  return (
    <div className="grid place-items-center h-full px-10 pb-16">
      <div className="flex flex-col items-center text-center gap-2 max-w-[28rem]">
        {encrypting != null ? (
          <LoadingIcon size="lg" className="text-text-subtle mb-1" />
        ) : (
          <Icon icon="lock" size="lg" className="text-text-subtle mb-1" />
        )}
        <div className="text-lg font-semibold">
          {encrypting != null ? `Encrypting stored traffic, ${encrypting}` : "Traffic is locked"}
        </div>
        <div className="text-sm text-text-subtle">
          {encrypting != null
            ? "Traffic captured before this version is being encrypted on disk. It shows here when it's done."
            : lockedLine(lock, getOsType())}
        </div>
        {encrypting == null && (
          <Button
            size="xs"
            variant="border"
            className="mt-2"
            isLoading={retry.isPending}
            onClick={() => retry.mutate({})}
          >
            Retry
          </Button>
        )}
        {encrypting == null && retry.error != null && (
          <div className="text-xs text-danger">{retry.error.message}</div>
        )}
      </div>
    </div>
  );
}
