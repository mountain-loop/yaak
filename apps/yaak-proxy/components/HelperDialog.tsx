import { useQueryClient } from "@tanstack/react-query";
import type { SystemProxyStatus } from "@yaakapp-internal/proxy-lib";
import { Banner, Dialog, DialogFooter, LoadingIcon } from "@yaakapp-internal/ui";
import { useAtom, useSetAtom } from "jotai";
import { useEffect } from "react";
import loginItems from "../assets/login-items.png";
import { useRpcMutation } from "../hooks/useRpcMutation";
import { useRpcQuery } from "../hooks/useRpcQuery";
import { helperDialogOpenAtom, helperRegisteredAtAtom } from "../lib/atoms";

/** Yaak Proxy's row in `login-items.png`, as percentages of the image, for the highlight */
const YAAK_PROXY_ROW = { left: 1, top: 34, width: 98, height: 32 };

/**
 * Walks through allowing the helper: registering it opens System Settings, where the user turns
 * it on. Stays open while macOS awaits that approval, and closes itself once it is given.
 */
export function HelperDialog() {
  const [open, setOpen] = useAtom(helperDialogOpenAtom);
  const queryClient = useQueryClient();
  const setRegisteredAt = useSetAtom(helperRegisteredAtAtom);
  // Polled by the header while approval is pending, so this sees it as soon as it is given.
  const status = useRpcQuery("system_proxy_status", {});
  const register = useRpcMutation("helper_register", {
    onSuccess: (status) => {
      setRegisteredAt(Date.now());
      queryClient.setQueryData<SystemProxyStatus>(["system_proxy_status", {}], status);
    },
  });
  const helper = status.data?.helper;
  const waiting = helper === "requires_approval";
  const { reset } = register;

  useEffect(() => {
    if (open && helper === "enabled") {
      setOpen(false);
      reset();
    }
  }, [open, helper, setOpen, reset]);

  const close = () => {
    setOpen(false);
    reset();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      size="dynamic"
      title="Turn on Yaak Proxy under Allow in the Background"
      description="In System Settings > General > Login Items. Newer macOS calls the list Background App Activity."
      className="w-[34rem]"
    >
      <div className="grid gap-3 pb-4">
        <div className="relative">
          <img
            src={loginItems}
            alt="System Settings, with Yaak Proxy's toggle in the list of apps allowed in the background"
            className="block w-full rounded-md border border-border-subtle"
          />
          <div
            aria-hidden
            className="absolute rounded-md ring-2 ring-primary bg-primary/10 pointer-events-none"
            style={{
              left: `${YAAK_PROXY_ROW.left}%`,
              top: `${YAAK_PROXY_ROW.top}%`,
              width: `${YAAK_PROXY_ROW.width}%`,
              height: `${YAAK_PROXY_ROW.height}%`,
            }}
          />
        </div>
        {register.error != null && <Banner color="danger">{register.error.message}</Banner>}
      </div>
      <DialogFooter
        leftSlot={
          waiting && (
            <span className="flex items-center gap-2 text-sm text-text-subtle">
              <LoadingIcon size="xs" />
              Waiting for approval
            </span>
          )
        }
        actions={[
          { label: waiting ? "Close" : "Cancel", onClick: close },
          {
            label: "Open System Settings",
            color: "primary",
            isLoading: register.isPending,
            onClick: () => register.mutate({}),
          },
        ]}
      />
    </Dialog>
  );
}
