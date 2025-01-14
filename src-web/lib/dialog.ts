import { atom } from 'jotai/index';
import type { DialogInstance } from '../components/Dialogs';
import { trackEvent } from './analytics';
import { jotaiStore } from './jotai';

export const dialogsAtom = atom<DialogInstance[]>([]);

export function showDialog({ id, ...props }: DialogInstance) {
  trackEvent('dialog', 'show', { id });
  jotaiStore.set(dialogsAtom, (a) => [...a.filter((d) => d.id !== id), { id, ...props }]);
}

export function toggleDialog({ id, ...props }: DialogInstance) {
  const dialogs = jotaiStore.get(dialogsAtom);
  if (dialogs.some((d) => d.id === id)) hideDialog(id);
  else showDialog({ id, ...props });
}

export function hideDialog(id: string) {
  jotaiStore.set(dialogsAtom, (a) => a.filter((d) => d.id !== id));
}
