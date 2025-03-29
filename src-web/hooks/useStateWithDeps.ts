import type { DependencyList } from 'react';
import { useEffect, useState } from 'react';

/**
 * Like useState, except it will update the value when the default value changes
 */
export function useStateWithDeps<T>(defaultValue: T | (() => T), deps: DependencyList) {
  const [value, setValue] = useState(defaultValue);
  useEffect(() => {
    setValue(defaultValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps]);
  return [value, setValue] as const;
}
