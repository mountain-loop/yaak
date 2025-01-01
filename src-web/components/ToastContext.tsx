import { createContext } from 'react';
import type { ToastState } from './Toasts';

export const ToastContext = createContext<ToastState>({} as ToastState);
