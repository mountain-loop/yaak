import { atom } from 'jotai';
import type { ToastInstance } from '../components/Toasts';
import { generateId } from './generateId';
import { jotaiStore } from './jotai';

export const toastsAtom = atom<ToastInstance[]>([]);

export function showToast({
  id,
  timeout = 5000,
  ...props
}: Omit<ToastInstance, 'id' | 'timeout' | 'uniqueKey'> & {
  id?: ToastInstance['id'];
  timeout?: ToastInstance['timeout'];
}) {
  id = id ?? generateId();
  const uniqueKey = generateId();

  const toasts = jotaiStore.get(toastsAtom);
  const toastWithSameId = toasts.find((t) => t.id === id);

  let delay = 0;
  if (toastWithSameId) {
    console.log('HIDING TOAST', id);
    hideToast(toastWithSameId);
    // Allow enough time for old toast to animate out
    delay = 200;
  }

  setTimeout(() => {
    const newToast: ToastInstance = { id, uniqueKey, timeout, ...props };
    if (timeout != null) {
      setTimeout(() => hideToast(newToast), timeout);
    }
    jotaiStore.set(toastsAtom, (prev) => [...prev, newToast]);
  }, delay);

  return id;
}

export function hideToast(toHide: ToastInstance) {
  jotaiStore.set(toastsAtom, (all) => {
    const t = all.find((t) => t.uniqueKey === toHide.uniqueKey);
    t?.onClose?.();
    return all.filter((t) => t.uniqueKey !== toHide.uniqueKey);
  });
}

export function showErrorToast<T>(id: string, message: T) {
  return showToast({
    id,
    message: String(message),
    timeout: 8000,
    color: 'danger',
  });
}
