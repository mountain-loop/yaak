import { useCallback, useState } from 'react';

export function useToggle(initialValue = false) {
  const [value, setValue] = useState<boolean>(initialValue);
  const toggle = useCallback(() => setValue((v) => !v), []);
  return [value, toggle, setValue] as const;
}
