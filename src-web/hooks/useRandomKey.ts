import { useCallback, useState } from 'react';
import { generateId } from '../lib/generateId';

export function useRandomKey() {
  const [value, setValue] = useState<string>(generateId());
  const regenerate = useCallback(() => setValue(generateId()), []);
  return [value, regenerate] as const;
}
