import { showErrorToast } from "./toast";

/**
 * Handles a fire-and-forget promise by catching and reporting errors
 * via console.error and a toast notification.
 */
export function fireAndForget(promise: Promise<unknown>) {
  promise.catch((err: unknown) => {
    console.error("Unhandled async error:", err);
    showErrorToast({
      id: "async-error",
      title: "Неожиданная ошибка",
      message: err instanceof Error ? err.message : String(err),
    });
  });
}
