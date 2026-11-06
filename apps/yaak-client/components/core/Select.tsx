import { platform } from "@yaakapp-internal/platform";
import { Select as BaseSelect, type SelectProps } from "@yaakapp-internal/ui";

export type { SelectProps } from "@yaakapp-internal/ui";

/** The shared select, as the system's own `<select>` on macOS */
export function Select<T extends string>(props: SelectProps<T>) {
  return <BaseSelect native={platform.osType() === "macos"} {...props} />;
}
