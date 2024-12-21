import { useContext } from 'react';
import { DialogContext } from '../components/DialogContext';

export function useDialog() {
  return useContext(DialogContext).actions;
}
