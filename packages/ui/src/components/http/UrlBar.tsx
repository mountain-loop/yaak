import classNames from "classnames";
import type { FormEvent, ReactNode } from "react";
import { memo, useCallback, useRef, useState } from "react";
import type { HotkeyAction } from "../../hooks/useHotKey";
import { useFormattedHotkey, useHotKey } from "../../hooks/useHotKey";
import type { HostInputProps } from "../EditorHost";
import { useEditorHost } from "../EditorHost";
import type { IconProps } from "../Icon";
import { IconButton } from "../IconButton";
import type { InputHandle } from "../Input";
import { HStack } from "../Stacks";

export type UrlBarProps = {
  url: string;
  className?: string;
  placeholder: string;
  onSend?: () => void;
  onUrlChange?: (url: string) => void;
  onPaste?: (v: string) => void;
  onPasteOverwrite?: HostInputProps["onPasteOverwrite"];
  onCancel?: () => void;
  submitIcon?: IconProps["icon"] | null;
  isLoading?: boolean;
  forceUpdateKey: string;
  rightSlot?: ReactNode;
  leftSlot?: ReactNode;
  autocomplete?: HostInputProps["autocomplete"];
  stateKey: HostInputProps["stateKey"];
  /** Show the URL without a way to change or send it */
  readOnly?: boolean;
  /** The action whose keys send, shown on the send button */
  sendHotkeyAction?: HotkeyAction;
  /** The action whose keys select the whole URL */
  focusHotkeyAction?: HotkeyAction;
};

export const UrlBar = memo(function UrlBar({
  forceUpdateKey,
  onUrlChange,
  url,
  placeholder,
  className,
  onSend,
  onCancel,
  onPaste,
  onPasteOverwrite,
  submitIcon = "send_horizontal",
  autocomplete,
  leftSlot,
  rightSlot,
  isLoading = false,
  stateKey,
  readOnly,
  sendHotkeyAction,
  focusHotkeyAction,
}: UrlBarProps) {
  const { Input } = useEditorHost();
  const inputRef = useRef<InputHandle>(null);
  const [isFocused, setIsFocused] = useState<boolean>(false);

  const handleInitInputRef = useCallback((h: InputHandle | null) => {
    inputRef.current = h;
  }, []);

  useHotKey(focusHotkeyAction ?? null, () => {
    inputRef.current?.selectAll();
  });

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (readOnly) return;
    if (isLoading) onCancel?.();
    else onSend?.();
  };

  return (
    <form onSubmit={handleSubmit} className={classNames("x-theme-urlBar", className)}>
      <Input
        setRef={handleInitInputRef}
        autocompleteFunctions
        autocompleteVariables
        stateKey={stateKey}
        size="sm"
        wrapLines={isFocused}
        hideLabel
        language="url"
        className="px-1.5 py-0.5"
        label="Enter URL"
        name="url"
        autocomplete={autocomplete}
        forceUpdateKey={forceUpdateKey}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onPaste={onPaste}
        onPasteOverwrite={onPasteOverwrite}
        onChange={onUrlChange}
        readOnly={readOnly}
        defaultValue={url}
        placeholder={placeholder}
        leftSlot={leftSlot}
        rightSlot={
          <HStack space={0.5}>
            {rightSlot && <div className="py-0.5 h-full">{rightSlot}</div>}
            {submitIcon !== null && !readOnly && (
              <div className="py-0.5 h-full">
                <SendButton
                  icon={isLoading ? "x" : submitIcon}
                  hotkeyAction={sendHotkeyAction ?? null}
                />
              </div>
            )}
          </HStack>
        }
      />
    </form>
  );
});

function SendButton({
  icon,
  hotkeyAction,
}: {
  icon: IconProps["icon"];
  hotkeyAction: HotkeyAction | null;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hotkeyTrigger = useFormattedHotkey(hotkeyAction)?.join("");
  useHotKey(hotkeyAction, () => buttonRef.current?.click());

  return (
    <IconButton
      ref={buttonRef}
      size="xs"
      iconSize="md"
      title={hotkeyTrigger ? `Send Request ${hotkeyTrigger}` : "Send Request"}
      type="submit"
      className="w-8 mr-0.5 h-full!"
      iconColor="secondary"
      icon={icon}
      onMouseDown={(e) => {
        // Prevent the button from taking focus
        e.preventDefault();
      }}
    />
  );
}
