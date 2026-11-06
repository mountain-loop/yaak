import { settingsAtom } from "@yaakapp-internal/models";
import {
  HttpMethodTag as BaseHttpMethodTag,
  HttpMethodTagRaw as BaseHttpMethodTagRaw,
} from "@yaakapp-internal/ui";
import { useAtomValue } from "jotai";
import { type ComponentProps, memo } from "react";

export const HttpMethodTag = memo(function HttpMethodTag(
  props: Omit<ComponentProps<typeof BaseHttpMethodTag>, "colored">,
) {
  const settings = useAtomValue(settingsAtom);
  return <BaseHttpMethodTag {...props} colored={settings.coloredMethods} />;
});

export function HttpMethodTagRaw({
  forceColor,
  ...props
}: Omit<ComponentProps<typeof BaseHttpMethodTagRaw>, "colored"> & { forceColor?: boolean }) {
  const settings = useAtomValue(settingsAtom);
  return <BaseHttpMethodTagRaw {...props} colored={forceColor || settings.coloredMethods} />;
}
