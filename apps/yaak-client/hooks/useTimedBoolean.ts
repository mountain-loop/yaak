import { useRef, useState } from 'react';
import { useUnmount } from 'react-use';

/** Returns a boolean that is true for a given number of milliseconds. */
export function useTimedBoolean(millis = 1500): [boolean, () => void] {
  const [value, setValue] = useState(false);
  const timeout = useRef<NodeJS.Timeout | null>(null);
  const reset = () => timeout.current && clearTimeout(timeout.current);

  useUnmount(reset);

  const setToTrue = () => {
    setValue(true);
    reset();
    timeout.current = setTimeout(() => setValue(false), millis);
  };

  return [value, setToTrue];
}
