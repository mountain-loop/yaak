export function eagerDebounceAsync(fn: () => Promise<void>, delay: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let runAfterInFlight = false;

  const run = async () => {
    if (inFlight != null) {
      runAfterInFlight = true;
      return;
    }

    runAfterInFlight = false;
    inFlight = fn()
      .catch(console.error)
      .finally(() => {
        inFlight = null;
        if (runAfterInFlight && timer == null) {
          void run();
        }
      });
    await inFlight;
  };

  return () => {
    if (timer == null) {
      void run();
    } else {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      timer = null;
      void run();
    }, delay);
  };
}
