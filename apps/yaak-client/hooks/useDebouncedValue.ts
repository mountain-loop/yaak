import { useEffect } from 'react';
import { useDebouncedState } from './useDebouncedState';

export function useDebouncedValue<T>(value: T, delay = 500) {
  const [state, setState] = useDebouncedState<T>(value, delay);
  useEffect(() => setState(value), [setState, value]);
  return state;
}
