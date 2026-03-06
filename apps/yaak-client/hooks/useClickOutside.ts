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
      if (ref.current == null || !(event.target instanceof HTMLElement)) {
        return;
      }
      const isIgnored = ignored?.current?.contains(event.target);
      const clickedOutside = !ref.current.contains(event.target);
      if (!isIgnored && clickedOutside) {
        savedCallback.current(event);
      }
    };
    // NOTE: We're using mousedown instead of click to handle some edge cases like when a context
    //  menu is open with the ctrl key.
    document.addEventListener('mousedown', handler, { capture: true });
    document.addEventListener('contextmenu', handler, { capture: true });
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('contextmenu', handler);
    };
  }, [ignored, ref]);
}
