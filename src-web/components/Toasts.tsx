import { AnimatePresence } from 'framer-motion';
import { useAtomValue } from 'jotai';
import React, { type ReactNode } from 'react';
import { hideToast, toastsAtom } from '../lib/toast';
import { Toast, type ToastProps } from './core/Toast';
import { Portal } from './Portal';

export type ToastInstance = {
  id: string;
  message: ReactNode;
  timeout: 3000 | 5000 | 8000 | null;
  onClose?: ToastProps['onClose'];
} & Omit<ToastProps, 'onClose' | 'open' | 'children' | 'timeout'>;

export const Toasts = () => {
  const toasts = useAtomValue(toastsAtom);
  return (
    <Portal name="toasts">
      <div className="absolute right-0 bottom-0 z-20">
        <AnimatePresence>
          {toasts.map(({ message, ...props }: ToastInstance) => (
            <Toast
              key={props.id}
              open
              {...props}
              // We call onClose inside actions.hide instead of passing to toast so that
              // it gets called from external close calls as well
              onClose={() => hideToast(props.id)}
            >
              {message}
            </Toast>
          ))}
        </AnimatePresence>
      </div>
    </Portal>
  );
};
