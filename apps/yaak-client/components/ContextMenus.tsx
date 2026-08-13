import { useAtomValue } from "jotai";
import { contextMenusAtom, hideContextMenu } from "../lib/contextMenu";
import { ContextMenu } from "./core/Dropdown";
import { ErrorBoundary } from "./ErrorBoundary";

/** Renders menus opened by {@link showContextMenu}, the way {@link Dialogs} renders dialogs. */
export function ContextMenus() {
  const menus = useAtomValue(contextMenusAtom);
  return (
    <>
      {menus.map(({ id, items, triggerPosition, triggerRect, triggerEl }) => (
        <ErrorBoundary key={id} name={`ContextMenu ${id}`}>
          <ContextMenu
            items={items}
            triggerPosition={triggerPosition}
            triggerRect={triggerRect}
            // The trigger isn't a React component here, so it arrives as an element and gets
            // wrapped to look like the ref the menu expects
            triggerRef={{ current: triggerEl ?? null }}
            onClose={() => hideContextMenu(id)}
          />
        </ErrorBoundary>
      ))}
    </>
  );
}
