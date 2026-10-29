import { atom } from "jotai";
import type { ReactNode } from "react";

export interface Toast {
  id: number;
  message: ReactNode;
  color?: "success" | "danger" | "info";
  /** A button beside the message */
  action?: { label: string; onClick: () => void };
}

/** How long a toast stays */
const TOAST_MS = 5000;

/** The toasts on screen, newest last */
export const toastsAtom = atom<Toast[]>([]);

let nextId = 1;

/** Shows a toast for `TOAST_MS`, with at most three on screen */
export const showToastAtom = atom(null, (_get, set, toast: Omit<Toast, "id">) => {
  const id = nextId++;
  set(toastsAtom, (toasts) => [...toasts.slice(-2), { ...toast, id }]);
  setTimeout(() => set(toastsAtom, (toasts) => toasts.filter((t) => t.id !== id)), TOAST_MS);
});
