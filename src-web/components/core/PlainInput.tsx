import classNames from 'classnames';
import type { FocusEvent, HTMLAttributes } from 'react';
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useRandomKey } from '../../hooks/useRandomKey';
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

export const PlainInput = forwardRef<{ focus: () => void }, PlainInputProps>(function PlainInput(
  {
    autoFocus,
    autoSelect,
    className,
    containerClassName,
    defaultValue,
    forceUpdateKey: forceUpdateKeyFromAbove,
    help,
    hideLabel,
    hideObscureToggle,
    label,
    labelClassName,
    labelPosition = 'top',
    leftSlot,
    name,
    onBlur,
    onChange,
    onFocus,
    onFocusRaw,
    onKeyDownCapture,
    onPaste,
    placeholder,
    required,
    rightSlot,
    size = 'md',
    tint,
    type = 'text',
    validate,
  },
  ref,
) {
  // Track a local key for updates. If the default value is changed when the input is not in focus,
  // regenerate this to force the field to update.
  const [focusedUpdateKey, regenerateFocusedUpdateKey] = useRandomKey();
  const forceUpdateKey = `${forceUpdateKeyFromAbove}::${focusedUpdateKey}`;

  const [obscured, setObscured] = useStateWithDeps(type === 'password', [type]);
  const [focused, setFocused] = useState(false);
  const [hasChanged, setHasChanged] = useStateWithDeps<boolean>(false, [forceUpdateKey]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle<{ focus: () => void } | null, { focus: () => void } | null>(
    ref,
    () => inputRef.current,
  );

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

  // Force input to update when receiving change and not in focus
  useLayoutEffect(() => {
    if (!focused) {
      regenerateFocusedUpdateKey();
    }
  }, [focused, regenerateFocusedUpdateKey, defaultValue]);

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
    [onChange, required, setHasChanged, validate],
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
      <Label
        htmlFor={id}
        className={labelClassName}
        visuallyHidden={hideLabel}
        required={required}
        help={help}
      >
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
            leftSlot ? 'pl-0.5 -ml-2' : null,
            rightSlot ? 'pr-0.5 -mr-2' : null,
          )}
        >
          <input
            id={id}
            ref={inputRef}
            key={forceUpdateKey}
            type={type === 'password' && !obscured ? 'text' : type}
            defaultValue={defaultValue ?? undefined}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(e) => handleChange(e.target.value)}
            onPaste={(e) => onPaste?.(e.clipboardData.getData('Text'))}
            className={classNames(commonClassName, 'h-full')}
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
});

function validateRequire(v: string) {
  return v.length > 0;
}
