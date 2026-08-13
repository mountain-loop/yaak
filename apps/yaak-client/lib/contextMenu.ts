import { atom } from "jotai";
import type { DropdownItem } from "../components/core/Dropdown";
import { jotaiStore } from "./jotai";

/**
 * A menu opened from somewhere that can't render React.
 *
 * Most menus in the app are a `Dropdown` wrapped around their own trigger. This is for the
 * cases where the trigger isn't a React component at all — a CodeMirror widget builds its DOM
 * synchronously, so it can only hand over a position and a list of items. Same shape as
 * {@link showDialog}.
 */
export interface ContextMenuInstance {
  id: string;
  /** Where to open, in viewport coordinates */
  triggerPosition: { x: number; y: number };
  /** The trigger's box, when it has one, so placement can align to its edges */
  triggerRect?: Pick<DOMRect, "top" | "bottom" | "left" | "right">;
  /** The element it belongs to, so clicking that doesn't read as a click outside */
  triggerEl?: HTMLElement | null;
  items: DropdownItem[];
}

export const contextMenusAtom = atom<ContextMenuInstance[]>([]);

export function showContextMenu({ id, ...props }: ContextMenuInstance) {
  jotaiStore.set(contextMenusAtom, (m) => [...m.filter((c) => c.id !== id), { id, ...props }]);
}

/**
 * Opens the menu, or closes it if this one is already open.
 *
 * What a trigger wants: pressing it a second time should put the menu away. Same shape as
 * {@link toggleDialog}.
 */
export function toggleContextMenu({ id, ...props }: ContextMenuInstance) {
  if (jotaiStore.get(contextMenusAtom).some((c) => c.id === id)) {
    hideContextMenu(id);
  } else {
    showContextMenu({ id, ...props });
  }
}

export function hideContextMenu(id: string) {
  jotaiStore.set(contextMenusAtom, (m) => m.filter((c) => c.id !== id));
}
