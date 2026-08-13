// oxlint-disable-next-line no-explicit-any
export function debounce(fn: (...args: any[]) => void, delay = 500) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  // oxlint-disable-next-line no-explicit-any
  let lastArgs: any[] | null = null;
  // oxlint-disable-next-line no-explicit-any
  const result = (...args: any[]) => {
    lastArgs = args;
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const argsToUse = lastArgs ?? [];
      lastArgs = null;
      fn(...argsToUse);
    }, delay);
  };
  result.cancel = () => {
    if (timer != null) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };
  // Invoke a pending call immediately instead of waiting out the delay
  result.flush = () => {
    if (timer == null) return;
    clearTimeout(timer);
    timer = null;
    const argsToUse = lastArgs ?? [];
    lastArgs = null;
    fn(...argsToUse);
  };
  return result;
}
