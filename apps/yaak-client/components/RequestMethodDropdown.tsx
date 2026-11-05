import type { HttpRequest } from "@yaakapp-internal/models";
import { patchModel, settingsAtom } from "@yaakapp-internal/models";
import { RequestMethodDropdown as BaseRequestMethodDropdown } from "@yaakapp-internal/ui";
import { useAtomValue } from "jotai";
import { memo, useCallback } from "react";

type Props = {
  request: HttpRequest;
  className?: string;
};

/** The shared method menu, writing to the request and coloured by the user's setting */
export const RequestMethodDropdown = memo(function RequestMethodDropdown({
  request,
  className,
}: Props) {
  const settings = useAtomValue(settingsAtom);
  const handleChange = useCallback(
    async (method: string) => {
      await patchModel(request, { method });
    },
    [request],
  );

  return (
    <BaseRequestMethodDropdown
      method={request.method}
      colored={settings.coloredMethods}
      onChange={handleChange}
      className={className}
    />
  );
});
