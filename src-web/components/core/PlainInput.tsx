import classNames from 'classnames';
import type { FocusEvent, HTMLAttributes } from 'react';
import { useCallback, useRef, useState } from 'react';
import { useStateWithDeps } from '../../hooks/useStateWithDeps';
import { IconButton } from './IconButton';
import type { InputProps } from './Input';
import { Label } from './Label';
import { HStack } from './Stacks';

export type PlainInputProps = Omit<InputProps, 'wrapLines' | 'onKeyDown' | 'type' | 'stateKey'> &
  Pick<HTMLAttributes<HTMLInputElement>, 'onKeyDownCapture'> & {
    onFocusRaw?: HTMLAttributes<HTMLInputElement>['onFocus'];
    type?: 'text' | 'password' | 'number';
    step?: number;
    hideObscureToggle?: boolean;
  };

export function PlainInput({
  className,
  containerClassName,
  defaultValue,
  forceUpdateKey,
  hideLabel,
  label,
  labelClassName,
  labelPosition = 'top',
  leftSlot,
  name,
  onBlur,
  onChange,
  onFocus,
  onPaste,
  required,
  rightSlot,
  hideObscureToggle,
  size = 'md',
  type = 'text',
  tint,
  validate,
  autoSelect,
  placeholder,
  autoFocus,
  onKeyDownCapture,
  onFocusRaw,
}: PlainInputProps) {
  const [obscured, setObscured] = useStateWithDeps(type === 'password', [type]);
  const [focused, setFocused] = useState(false);
  const [hasChanged, setHasChanged] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleFocus = useCallback(
    (e: FocusEvent<HTMLInputElement>) => {
      onFocusRaw?.(e);
      setFocused(true);
      if (autoSelect) {
        inputRef.current?.select();
        textareaRef.current?.select();
      }
      onFocus?.();
    },
    [autoSelect, onFocus, onFocusRaw],
  );

  const handleBlur = useCallback(() => {
    setFocused(false);
    onBlur?.();
  }, [onBlur]);

  const id = `input-${name}`;
  const commonClassName = classNames(
    className,
    '!bg-transparent min-w-0 w-full focus:outline-none placeholder:text-placeholder',
    'px-2 text-xs font-mono cursor-text',
  );

  const handleChange = useCallback(
    (value: string) => {
      onChange?.(value);
      setHasChanged(true);
      const isValid = (value: string) => {
        if (required && !validateRequire(value)) return false;
        if (typeof validate === 'boolean') return validate;
        if (typeof validate === 'function' && !validate(value)) return false;
        return true;
      };
      inputRef.current?.setCustomValidity(isValid(value) ? '' : 'Invalid value');
    },
    [onChange, required, validate],
  );

  const wrapperRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={wrapperRef}
      className={classNames(
        'w-full',
        'pointer-events-auto', // Just in case we're placing in disabled parent
        labelPosition === 'left' && 'flex items-center gap-2',
        labelPosition === 'top' && 'flex-row gap-0.5',
      )}
    >
      <Label htmlFor={id} className={labelClassName} visuallyHidden={hideLabel} required={required}>
        {label}
      </Label>
      <HStack
        alignItems="stretch"
        className={classNames(
          containerClassName,
          'x-theme-input',
          'relative w-full rounded-md text',
          'border',
          focused ? 'border-border-focus' : 'border-border-subtle',
          hasChanged && 'has-[:invalid]:border-danger', // For built-in HTML validation
          size === 'md' && 'min-h-md',
          size === 'sm' && 'min-h-sm',
          size === 'xs' && 'min-h-xs',
          size === '2xs' && 'min-h-2xs',
        )}
      >
        {tint != null && (
          <div
            aria-hidden
            className={classNames(
              'absolute inset-0 opacity-5 pointer-events-none',
              tint === 'info' && 'bg-info',
              tint === 'warning' && 'bg-warning',
            )}
          />
        )}
        {leftSlot}
        <HStack
          className={classNames(
            'w-full min-w-0',
            leftSlot && 'pl-0.5 -ml-2',
            rightSlot && 'pr-0.5 -mr-2',
          )}
        >
          <input
            ref={inputRef}
            key={forceUpdateKey}
            id={id}
            type={type === 'password' && !obscured ? 'text' : type}
            defaultValue={defaultValue ?? undefined}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(e) => handleChange(e.target.value)}
            onPaste={(e) => onPaste?.(e.clipboardData.getData('Text'))}
            className={classNames(commonClassName, 'h-auto')}
            onFocus={handleFocus}
            onBlur={handleBlur}
            required={required}
            autoFocus={autoFocus}
            placeholder={placeholder}
            onKeyDownCapture={onKeyDownCapture}
          />
        </HStack>
        {type === 'password' && !hideObscureToggle && (
          <IconButton
            title={obscured ? `Show ${label}` : `Obscure ${label}`}
            size="xs"
            className="mr-0.5 group/obscure !h-auto my-0.5"
            iconClassName="group-hover/obscure:text"
            iconSize="sm"
            icon={obscured ? 'eye' : 'eye_closed'}
            onClick={() => setObscured((o) => !o)}
          />
        )}
        {rightSlot}
      </HStack>
    </div>
  );
}

function validateRequire(v: string) {
  return v.length > 0;
}
