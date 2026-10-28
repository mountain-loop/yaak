import { Dropdown, type DropdownItem, IconButton } from "@yaakapp-internal/ui";
import { useAtomValue } from "jotai";
import { useRpcMutation } from "../hooks/useRpcMutation";
import { flowTotalAtom } from "../lib/store";

/** Deletes every flow, once confirmed in its menu, which its hotkey opens too */
export function ClearFlowsButton() {
  const total = useAtomValue(flowTotalAtom);
  const clear = useRpcMutation("clear_flows");

  const items: DropdownItem[] = [
    {
      type: "content",
      label: (
        <div className="px-1.5 py-1 max-w-[17rem]">
          <div className="text-sm text-text">
            {total === 1 ? "Clear 1 flow?" : `Clear all ${total} flows?`}
          </div>
          <div className="text-xs text-text-subtle mt-0.5">
            {clear.error != null ? (
              <span className="text-danger">{clear.error.message}</span>
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
      onSelect: () => clear.mutate({}),
    },
  ];

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
