import {
  IconButton as BaseIconButton,
  type IconButtonProps as BaseIconButtonProps,
} from '@yaakapp-internal/ui';
import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { HotkeyAction } from '../../hooks/useHotKey';
import { useFormattedHotkey, useHotKey } from '../../hooks/useHotKey';

export type IconButtonProps = BaseIconButtonProps & {
  hotkeyAction?: HotkeyAction;
  hotkeyLabelOnly?: boolean;
  hotkeyPriority?: number;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { hotkeyAction, hotkeyPriority, hotkeyLabelOnly, title, ...props }: IconButtonProps,
  ref,
) {
  const hotkeyTrigger = useFormattedHotkey(hotkeyAction ?? null)?.join('');
  const fullTitle = hotkeyTrigger ? `${title ?? ''} ${hotkeyTrigger}`.trim() : title;

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

  return <BaseIconButton ref={buttonRef} title={fullTitle} {...props} />;
});
