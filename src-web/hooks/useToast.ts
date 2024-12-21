import { useContext } from 'react';
import { ToastContext } from '../components/ToastContext';

export function useToast() {
  return useContext(ToastContext).actions;
}
