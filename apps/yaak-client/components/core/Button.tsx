import { Button as BaseButton, type ButtonProps as BaseButtonProps } from "@yaakapp-internal/ui";
import { forwardRef, useImperativeHandle, useRef } from "react";
import type { HotkeyAction } from "../../hooks/useHotKey";
import { useFormattedHotkey, useHotKey } from "../../hooks/useHotKey";

export type ButtonProps = BaseButtonProps & {
  hotkeyAction?: HotkeyAction;
  hotkeyLabelOnly?: boolean;
  hotkeyPriority?: number;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { hotkeyAction, hotkeyPriority, hotkeyLabelOnly, title, ...props }: ButtonProps,
  ref,
) {
  const hotkeyTrigger = useFormattedHotkey(hotkeyAction ?? null)?.join("");
  const fullTitle = hotkeyTrigger ? `${title ?? ""} ${hotkeyTrigger}`.trim() : title;

  const buttonRef = useRef<HTMLButtonElement>(null);
  useImperativeHandle<HTMLButtonElement | null, HTMLButtonElement | null>(
    ref,
    () => buttonRef.current,
  );

  useHotKey(
    hotkeyAction ?? null,
    () => {
      buttonRef.current?.click();
    },
    { priority: hotkeyPriority, enable: !hotkeyLabelOnly },
  );

  return <BaseButton ref={buttonRef} title={fullTitle} {...props} />;
});
