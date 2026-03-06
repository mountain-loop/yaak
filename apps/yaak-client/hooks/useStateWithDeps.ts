import type { DependencyList } from 'react';
import { useEffect, useState } from 'react';

/**
 * Like useState, except it will update the value when the default value changes
 */
export function useStateWithDeps<T>(defaultValue: T | (() => T), deps: DependencyList) {
  const [value, setValue] = useState(defaultValue);
  // biome-ignore lint/correctness/useExhaustiveDependencies: none
  useEffect(() => {
    setValue(defaultValue);
  }, [...deps]);
  return [value, setValue] as const;
}
