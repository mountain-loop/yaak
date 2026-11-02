import { useAtomValue, useStore } from "jotai";
import { AnimatePresence } from "motion/react";
import { hideToast, type ToastInstance, toastsAtom } from "../lib/toast";
import { ErrorBoundary } from "./ErrorBoundary";
import { Portal } from "./Portal";
import { Toast } from "./Toast";

/** The toasts in the app's jotai store, bottom right */
export function Toasts({ onShowError }: { onShowError?: (error: unknown) => void }) {
  const store = useStore();
  const toasts = useAtomValue(toastsAtom);
  return (
    <Portal name="toasts">
      <div className="absolute right-0 bottom-0 z-50">
        <AnimatePresence>
          {toasts.map((toast: ToastInstance) => {
            const { message, uniqueKey, ...props } = toast;
            return (
              <ErrorBoundary key={uniqueKey} name={`Toast ${uniqueKey}`} onShowError={onShowError}>
                <Toast
                  open
                  {...props}
                  // We call onClose inside actions.hide instead of passing to toast so that
                  // it gets called from external close calls as well
                  onClose={() => hideToast(store, toast)}
                >
                  {message}
                </Toast>
              </ErrorBoundary>
            );
          })}
        </AnimatePresence>
      </div>
    </Portal>
  );
}
