import type { MutableRefObject } from 'react';
import { useLayoutEffect, useState } from 'react';

export function useContainerSize(ref: MutableRefObject<HTMLElement | null>) {
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (el) {
      const observer = new ResizeObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.target === el) {
            setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
          }
        });
      });

      observer.observe(el);

      return () => {
        observer.unobserve(el);
        observer.disconnect();
      };
    }

    return undefined;
  }, [ref]);

  return size;
}
