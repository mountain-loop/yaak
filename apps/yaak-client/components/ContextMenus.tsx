import { useAtomValue } from "jotai";
import { contextMenusAtom, hideContextMenu } from "../lib/contextMenu";
import { ContextMenu } from "./core/Dropdown";
import { ErrorBoundary } from "./ErrorBoundary";

/** Renders menus opened by {@link showContextMenu}, the way {@link Dialogs} renders dialogs. */
export function ContextMenus() {
  const menus = useAtomValue(contextMenusAtom);
  return (
    <>
      {menus.map(({ id, items, triggerPosition, triggerRect }) => (
        <ErrorBoundary key={id} name={`ContextMenu ${id}`}>
          <ContextMenu
            items={items}
            triggerPosition={triggerPosition}
            triggerRect={triggerRect}
            onClose={() => hideContextMenu(id)}
          />
        </ErrorBoundary>
      ))}
    </>
  );
}
