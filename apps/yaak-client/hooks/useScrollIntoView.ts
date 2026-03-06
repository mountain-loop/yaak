import { useEffect } from 'react';

export function useScrollIntoView<T extends HTMLElement>(node: T | null, enabled: boolean) {
  useEffect(() => {
    if (enabled) {
      node?.scrollIntoView({ block: 'nearest' });
    }
  }, [enabled, node]);
}
