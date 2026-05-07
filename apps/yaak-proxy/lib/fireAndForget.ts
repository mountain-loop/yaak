export function fireAndForget(promise: Promise<unknown>) {
  promise.catch((err: unknown) => {
    console.error("Unhandled async error:", err);
  });
}
