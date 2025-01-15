import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';

/**
 * Get notified when a mouse click happens outside the target ref
 * @param ref The element to be notified when a mouse click happens outside it
 * @param onClickAway
 * @param ignored Optional outside element to ignore (useful for dropdown triggers)
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onClickAway: (event: MouseEvent) => void,
  ignored?: RefObject<HTMLElement | null>,
) {
  const savedCallback = useRef(onClickAway);
  useEffect(() => {
    savedCallback.current = onClickAway;
  }, [onClickAway]);
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current == null || !(event.target instanceof HTMLElement)) return;
      const isIgnored = ignored?.current?.contains(event.target);
      const clickedOutside = !ref.current.contains(event.target);
      if (!isIgnored && clickedOutside) {
        savedCallback.current(event);
      }
    };
    document.addEventListener('click', handler);
    return () => {
      document.removeEventListener('click', handler);
    };
  }, [ignored, ref]);
}
