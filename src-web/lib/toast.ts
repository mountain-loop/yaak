import { atom } from 'jotai/index';
import type { ToastInstance } from '../components/Toasts';
import { generateId } from './generateId';
import { jotaiStore } from './jotai';

export const toastsAtom = atom<ToastInstance[]>([]);

export function showToast({
  id,
  timeout = 5000,
  ...props
}: Omit<ToastInstance, 'id' | 'timeout'> & {
  id?: ToastInstance['id'];
  timeout?: ToastInstance['timeout'];
}) {
  id = id ?? generateId();
  if (timeout != null) {
    setTimeout(() => hideToast(id), timeout);
  }
  jotaiStore.set(toastsAtom, (a) => {
    if (a.some((v) => v.id === id)) {
      // It's already visible with this id
      return a;
    }
    return [...a, { id, timeout, ...props }];
  });
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
