import type { HttpRequest } from '@yaakapp-internal/models';
import classNames from 'classnames';
import type { FormEvent, ReactNode } from 'react';
import { useCallback, memo, useRef, useState } from 'react';
import { useHotKey } from '../hooks/useHotKey';
import type { IconProps } from './core/Icon';
import { IconButton } from './core/IconButton';
import type { InputHandle, InputProps } from './core/Input';
import { Input } from './core/Input';
import { HStack } from './core/Stacks';

type Props = Pick<HttpRequest, 'url'> & {
  className?: string;
  placeholder: string;
  onSend: () => void;
  onUrlChange: (url: string) => void;
  onPaste?: (v: string) => void;
  onPasteOverwrite?: InputProps['onPasteOverwrite'];
  onCancel: () => void;
  submitIcon?: IconProps['icon'] | null;
  isLoading: boolean;
  forceUpdateKey: string;
  rightSlot?: ReactNode;
  leftSlot?: ReactNode;
  autocomplete?: InputProps['autocomplete'];
  stateKey: InputProps['stateKey'];
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
  submitIcon = 'send_horizontal',
  autocomplete,
  leftSlot,
  rightSlot,
  isLoading,
  stateKey,
}: Props) {
  const inputRef = useRef<InputHandle>(null);
  const [isFocused, setIsFocused] = useState<boolean>(false);

  const handleInitInputRef = useCallback((h: InputHandle | null) => {
    inputRef.current = h;
  }, []);

  useHotKey('url_bar.focus', () => {
    inputRef.current?.selectAll();
  });

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isLoading) onCancel();
    else onSend();
  };

  return (
    <form onSubmit={handleSubmit} className={classNames('x-theme-urlBar', className)}>
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
        defaultValue={url}
        placeholder={placeholder}
        leftSlot={leftSlot}
        rightSlot={
          <HStack space={0.5}>
            {rightSlot && <div className="py-0.5 h-full">{rightSlot}</div>}
            {submitIcon !== null && (
              <div className="py-0.5 h-full">
                <IconButton
                  size="xs"
                  iconSize="md"
                  title="Send Request"
                  type="submit"
                  className="w-8 mr-0.5 !h-full"
                  iconColor="secondary"
                  icon={isLoading ? 'x' : submitIcon}
                  hotkeyAction="request.send"
                  onMouseDown={(e) => {
                    // Prevent the button from taking focus
                    e.preventDefault();
                  }}
                />
              </div>
            )}
          </HStack>
        }
      />
    </form>
  );
});
