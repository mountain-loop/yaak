import { Dropdown, type DropdownItem, IconButton } from "@yaakapp-internal/ui";
import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import { clearFlowsAtom, flowTotalAtom, lockedAtom } from "../lib/store";

/**
 * Clears every flow, once confirmed in its menu, which its hotkey opens too. The list empties at
 * once; the flows are deleted in the background. Disabled with none to clear, or while captured
 * traffic is locked.
 */
export function ClearFlowsButton() {
  const total = useAtomValue(flowTotalAtom);
  const locked = useAtomValue(lockedAtom);
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

  // Nothing to clear, or nothing that can be read while traffic is locked: no menu, nor hotkey.
  if (locked != null || total === 0) {
    return (
      <IconButton
        className="pointer-events-auto"
        icon="trash"
        title={locked != null ? "Clear flows (traffic is locked)" : "Clear flows (none yet)"}
        size="sm"
        iconColor="secondary"
        disabled
      />
    );
  }

  return (
    <Dropdown items={items} hotKeyAction="flows_clear">
      <IconButton
        className="pointer-events-auto"
        icon="trash"
        title="Clear flows"
        size="sm"
        iconColor="secondary"
      />
    </Dropdown>
  );
}
