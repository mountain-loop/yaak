import { atom } from 'jotai/index';
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
  if (timeout != null) {
    setTimeout(() => hideToast(id), timeout);
  }
  const toasts = jotaiStore.get(toastsAtom);
  const isVisible = toasts.some((t) => t.id === id);

  let delay = 0;
  if (isVisible) {
    console.log('HIDING TOAST', id);
    hideToast(id);
    // Allow enough time for old toast to animate out
    delay = 200;
  }

  setTimeout(() => {
    const uniqueKey = generateId();
    const newToastProps: ToastInstance = { id, uniqueKey, timeout, ...props };
    jotaiStore.set(toastsAtom, (prev) => [...prev, newToastProps]);
  }, delay);

  return id;
}

export function hideToast(id: string) {
  jotaiStore.set(toastsAtom, (all) => {
    const t = all.find((t) => t.id === id);
    t?.onClose?.();
    return all.filter((t) => t.id !== id);
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
