import { useEffect } from 'react';

export function useKeyboardEvent(
  event: 'keyup' | 'keydown',
  key: KeyboardEvent['key'],
  cb: () => void,
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: Don't have `cb` as a dep for caller convenience
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === key) cb();
    };
    document.addEventListener(event, fn);
    return () => document.removeEventListener(event, fn);
  }, [event]);
}
