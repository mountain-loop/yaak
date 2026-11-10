import {
  Checkbox,
  Dialog,
  DialogFooter,
  IconButton,
  useFormattedHotkey,
  useHotKey,
} from "@yaakapp-internal/ui";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { type FormEvent, useCallback, useId, useState } from "react";
import { clearFlowsAction, confirmClearFlowsAtom } from "../lib/clearFlows";
import { clearFlowsAtom, flowTotalAtom, lockedAtom } from "../lib/store";
import { useShowToast } from "../lib/toast";

/**
 * Clears every flow, from its button or hotkey, once confirmed in a dialog unless "Don't ask
 * again" was checked there. The list empties at once; the flows are deleted in the background.
 * Disabled with none to clear, or while captured traffic is locked.
 */
export function ClearFlowsButton() {
  const total = useAtomValue(flowTotalAtom);
  const locked = useAtomValue(lockedAtom);
  const [confirm, setConfirm] = useAtom(confirmClearFlowsAtom);
  const clearFlows = useSetAtom(clearFlowsAtom);
  const showToast = useShowToast();
  const [confirming, setConfirming] = useState(false);
  const action = clearFlowsAction({ total, locked: locked != null, confirm });
  const hotkey = useFormattedHotkey("flows_clear")?.join("");

  const clear = useCallback(() => {
    clearFlows().catch((err: unknown) => {
      const message = (err as { message?: unknown } | null)?.message;
      showToast({ message: typeof message === "string" ? message : String(err), color: "danger" });
    });
  }, [clearFlows, showToast]);

  const start = useCallback(() => {
    if (action === "confirm") setConfirming(true);
    else if (action === "clear") clear();
  }, [action, clear]);

  // Bound even when disabled, so the key never falls through to the backend's clear unasked
  useHotKey("flows_clear", start);

  return (
    <>
      <IconButton
        className="pointer-events-auto"
        icon="trash"
        title={
          locked != null
            ? "Clear flows (traffic is locked)"
            : total === 0
              ? "Clear flows (none yet)"
              : hotkey == null
                ? "Clear flows"
                : `Clear flows ${hotkey}`
        }
        tooltip
        size="sm"
        iconColor="secondary"
        disabled={action === "disabled"}
        onClick={start}
      />
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        size="sm"
        title="Clear traffic?"
      >
        {confirming && (
          <ConfirmClear
            total={total}
            onCancel={() => setConfirming(false)}
            onClear={(dontAskAgain) => {
              setConfirming(false);
              if (dontAskAgain) setConfirm(false);
              clear();
            }}
          />
        )}
      </Dialog>
    </>
  );
}

function ConfirmClear({
  total,
  onCancel,
  onClear,
}: {
  total: number;
  onCancel: () => void;
  onClear: (dontAskAgain: boolean) => void;
}) {
  const formId = useId();
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onClear(dontAskAgain);
  };
  return (
    <form id={formId} className="flex flex-col gap-3" onSubmit={handleSubmit}>
      <p>
        {total === 1
          ? "1 flow will be removed."
          : `${total.toLocaleString()} flows will be removed.`}
      </p>
      <Checkbox checked={dontAskAgain} title="Don't ask again" onChange={setDontAskAgain} />
      <DialogFooter
        inline
        actions={[
          { label: "Cancel", onClick: onCancel },
          { label: "Clear", color: "danger", form: formId, autoFocus: true },
        ]}
      />
    </form>
  );
}
