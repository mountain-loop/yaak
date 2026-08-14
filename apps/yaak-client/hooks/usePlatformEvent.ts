import { platform } from "@yaakapp-internal/platform";
import { useEffect, useRef } from "react";

/** Subscribe to a backend event for the lifetime of the component. */
export function usePlatformEvent<T>(event: string, fn: (payload: T) => void) {
  const handlerRef = useRef(fn);
  useEffect(() => {
    handlerRef.current = fn;
  }, [fn]);

  useEffect(() => platform.listen<T>(event, (payload) => handlerRef.current(payload)), [event]);
}
