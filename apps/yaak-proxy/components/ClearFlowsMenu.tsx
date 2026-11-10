import { Dropdown, type DropdownItem, type DropdownRef } from "@yaakapp-internal/ui";
import { useAtomValue, useSetAtom } from "jotai";
import type { Ref } from "react";
import { useState } from "react";
import { clearFlowsAtom, flowTotalAtom, lockedAtom } from "../lib/store";

/** Whether there are flows to clear: some, and readable, as they aren't while traffic is locked */
export function useCanClearFlows(): boolean {
  const total = useAtomValue(flowTotalAtom);
  const locked = useAtomValue(lockedAtom);
  return locked == null && total > 0;
}

/**
 * Clears every flow, once confirmed in its menu, which its hotkey or the status menu's Clear
 * Traffic opens. It has no button of its own: it covers the element it is placed over, without
 * taking the pointer, so the menu opens from there. The list empties at once; the flows are
 * deleted in the background. Neither menu nor hotkey with nothing to clear, or while captured
 * traffic is locked.
 */
export function ClearFlowsMenu({ ref }: { ref?: Ref<DropdownRef> }) {
  const total = useAtomValue(flowTotalAtom);
  const canClear = useCanClearFlows();
  const clear = useSetAtom(clearFlowsAtom);
  const [error, setError] = useState<string | null>(null);

  const items: DropdownItem[] = [
    {
      type: "content",
      label: (
        <div className="px-1.5 py-1 max-w-[17rem]">
          <div className="text-sm text-text">
            {total === 1 ? "Clear 1 flow?" : `Clear all ${total.toLocaleString()} flows?`}
          </div>
          <div className="text-xs text-text-subtle mt-0.5">
            {error != null ? (
              <span className="text-danger">{error}</span>
            ) : (
              "They are deleted from disk with their bodies, for good."
            )}
          </div>
        </div>
      ),
    },
    { type: "separator" },
    {
      label: "Clear",
      icon: "trash",
      color: "danger",
      onSelect: () => {
        setError(null);
        clear().catch((err: unknown) => {
          const message = (err as { message?: unknown } | null)?.message;
          setError(typeof message === "string" ? message : String(err));
        });
      },
    },
  ];

  return (
    <Dropdown
      ref={ref}
      items={canClear ? items : []}
      hotKeyAction={canClear ? "flows_clear" : undefined}
    >
      <span aria-hidden className="absolute inset-0 pointer-events-none" />
    </Dropdown>
  );
}
