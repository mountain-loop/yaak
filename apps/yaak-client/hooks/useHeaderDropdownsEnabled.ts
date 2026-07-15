import { useCallback } from "react";
import { useKeyValue } from "./useKeyValue";

/**
 * Whether to show ARC-style dropdown pickers next to header name and value
 * inputs. A small chevron lets users browse and pick common header names
 * (Content-Type, User-Agent, ...) and values without having to know what to
 * type.
 *
 * This is purely additive: inline autocomplete is always available regardless
 * of this setting. Off by default.
 */
export function useHeaderDropdownsEnabled() {
  const { value, set } = useKeyValue<boolean>({
    namespace: "global",
    key: "header_dropdowns_enabled",
    fallback: false,
  });

  const setEnabled = useCallback((enabled: boolean) => set(enabled), [set]);

  return [value ?? false, setEnabled] as const;
}
