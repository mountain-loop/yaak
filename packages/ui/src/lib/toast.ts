import { generateId } from "@yaakapp-internal/lib/generateId";
import { atom, type createStore } from "jotai";
import type { ReactNode } from "react";
import type { ToastProps } from "../components/Toast";

type Store = ReturnType<typeof createStore>;

export type ToastInstance = {
  id: string;
  uniqueKey: string;
  message: ReactNode;
  timeout: 3000 | 5000 | 8000 | (number & {}) | null;
  onClose?: ToastProps["onClose"];
} & Omit<ToastProps, "onClose" | "open" | "children" | "timeout">;

export type ShowToastArgs = Omit<ToastInstance, "id" | "timeout" | "uniqueKey"> & {
  id?: ToastInstance["id"];
  timeout?: ToastInstance["timeout"];
};

/** The toasts on screen, which `Toasts` renders from the app's store */
export const toastsAtom = atom<ToastInstance[]>([]);

/** Shows a toast in `store`, replacing one with the same id. Returns its id. */
export function showToast(store: Store, { id, timeout = 5000, ...props }: ShowToastArgs) {
  const toastId = id ?? generateId();
  const uniqueKey = generateId();

  const toasts = store.get(toastsAtom);
  const toastWithSameId = toasts.find((t) => t.id === toastId);

  let delay = 0;
  if (toastWithSameId) {
    hideToast(store, toastWithSameId);
    // Allow enough time for old toast to animate out
    delay = 200;
  }

  setTimeout(() => {
    const newToast: ToastInstance = { id: toastId, uniqueKey, timeout, ...props };
    store.set(toastsAtom, (prev) => [...prev, newToast]);
  }, delay);

  return toastId;
}

export function hideToastById(store: Store, id: string) {
  const toast = store.get(toastsAtom).find((t) => t.id === id);
  if (toast) hideToast(store, toast);
}

export function hideToast(store: Store, toHide: ToastInstance) {
  store.set(toastsAtom, (all) => {
    const t = all.find((t) => t.uniqueKey === toHide.uniqueKey);
    t?.onClose?.();
    return all.filter((t) => t.uniqueKey !== toHide.uniqueKey);
  });
}
