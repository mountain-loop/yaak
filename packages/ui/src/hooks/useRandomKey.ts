import { useCallback, useState } from "react";
import { generateId } from "@yaakapp-internal/lib/generateId";

export function useRandomKey(initialValue?: string) {
  const [value, setValue] = useState<string>(initialValue ?? generateId());
  const regenerate = useCallback(() => setValue(generateId()), []);
  return [value, regenerate] as const;
}
