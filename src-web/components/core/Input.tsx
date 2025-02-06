import classNames from 'classnames';
import type { EditorView } from 'codemirror';
import type { ReactNode } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useStateWithDeps } from '../../hooks/useStateWithDeps';
import { generateId } from '../../lib/generateId';
import type { EditorProps } from './Editor/Editor';
import { Editor } from './Editor/Editor';
import { IconButton } from './IconButton';
import { Label } from './Label';
import { HStack } from './Stacks';

export type InputProps = Pick<
  EditorProps,
  | 'language'
  | 'useTemplating'
  | 'autocomplete'
  | 'forceUpdateKey'
  | 'disabled'
  | 'autoFocus'
  | 'autoSelect'
  | 'autocompleteVariables'
  | 'onKeyDown'
  | 'readOnly'
> & {
  name?: string;
  type?: 'text' | 'password';
  label: ReactNode;
  hideLabel?: boolean;
  labelPosition?: 'top' | 'left';
  labelClassName?: string;
  containerClassName?: string;
  inputWrapperClassName?: string;
  onChange?: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onPaste?: (value: string) => void;
  onPasteOverwrite?: (value: string) => void;
  defaultValue?: string;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  size?: 'xs' | 'sm' | 'md' | 'auto';
  className?: string;
  placeholder?: string;
  validate?: boolean | ((v: string) => boolean);
  required?: boolean;
  wrapLines?: boolean;
  multiLine?: boolean;
  fullHeight?: boolean;
  stateKey: EditorProps['stateKey'];
};

export const Input = forwardRef<EditorView, InputProps>(function Input(
  {
    className,
    containerClassName,
    inputWrapperClassName,
    defaultValue,
    forceUpdateKey,
    fullHeight,
    hideLabel,
    label,
    labelClassName,
    labelPosition = 'top',
    leftSlot,
    onBlur,
    onChange,
    onFocus,
    onPaste,
    onPasteOverwrite,
    placeholder,
    required,
    rightSlot,
    wrapLines,
    size = 'md',
    type = 'text',
    validate,
    readOnly,
    stateKey,
    multiLine,
    disabled,
    ...props
  }: InputProps,
  ref,
) {
  const [obscured, setObscured] = useStateWithDeps(type === 'password', [type]);
  const [currentValue, setCurrentValue] = useState(defaultValue ?? '');
  const [focused, setFocused] = useState(false);
  const [hasChanged, setHasChanged] = useStateWithDeps<boolean>(false, [stateKey, forceUpdateKey]);
  const editorRef = useRef<EditorView | null>(null);
  useImperativeHandle<EditorView | null, EditorView | null>(ref, () => editorRef.current);

  const handleFocus = useCallback(() => {
    if (readOnly) return;
    setFocused(true);
    // Select all text on focus
    editorRef.current?.dispatch({
      selection: { anchor: 0, head: editorRef.current.state.doc.length },
    });
    onFocus?.();
  }, [onFocus, readOnly]);

  const handleBlur = useCallback(() => {
    setFocused(false);
    // Move selection to the end on blur
    editorRef.current?.dispatch({
      selection: { anchor: editorRef.current.state.doc.length },
    });
    onBlur?.();
  }, [onBlur]);

  const id = useRef(`input-${generateId()}`);
  const editorClassName = classNames(
    className,
    '!bg-transparent min-w-0 h-auto w-full focus:outline-none placeholder:text-placeholder',
  );

  const isValid = useMemo(() => {
    if (required && !validateRequire(currentValue)) return false;
    if (typeof validate === 'boolean') return validate;
    if (typeof validate === 'function' && !validate(currentValue)) return false;
    return true;
  }, [required, currentValue, validate]);

  const handleChange = useCallback(
    (value: string) => {
      setCurrentValue(value);
      onChange?.(value);
      setHasChanged(true);
    },
    [onChange, setHasChanged],
  );

  const wrapperRef = useRef<HTMLDivElement>(null);

  // Submit the nearest form on Enter key press
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;

      const form = wrapperRef.current?.closest('form');
      if (!isValid || form == null) return;

      form?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    },
    [isValid],
  );

  return (
    <div
      ref={wrapperRef}
      className={classNames(
        'pointer-events-auto', // Just in case we're placing in disabled parent
        'w-full',
        fullHeight && 'h-full',
        labelPosition === 'left' && 'flex items-center gap-2',
        labelPosition === 'top' && 'flex-row gap-0.5',
      )}
    >
      <Label
        htmlFor={id.current}
        required={required}
        visuallyHidden={hideLabel}
        className={classNames(labelClassName)}
      >
        {label}
      </Label>
      <HStack
        alignItems="stretch"
        className={classNames(
          containerClassName,
          fullHeight && 'h-full',
          'x-theme-input',
          'relative w-full rounded-md text',
          'border',
          focused && !disabled ? 'border-border-focus' : 'border-border',
          disabled && 'border-dotted',
          !isValid && hasChanged && '!border-danger',
          size === 'md' && 'min-h-md',
          size === 'sm' && 'min-h-sm',
          size === 'xs' && 'min-h-xs',
        )}
      >
        {leftSlot}
        <HStack
          className={classNames(
            inputWrapperClassName,
            'w-full min-w-0 px-2',
            fullHeight && 'h-full',
            leftSlot && 'pl-0.5 -ml-2',
            rightSlot && 'pr-0.5 -mr-2',
          )}
        >
          <Editor
            ref={editorRef}
            id={id.current}
            hideGutter
            singleLine={!multiLine}
            stateKey={stateKey}
            wrapLines={wrapLines}
            heightMode="auto"
            onKeyDown={handleKeyDown}
            type={type === 'password' && !obscured ? 'text' : type}
            defaultValue={defaultValue}
            forceUpdateKey={forceUpdateKey}
            placeholder={placeholder}
            onChange={handleChange}
            onPaste={onPaste}
            onPasteOverwrite={onPasteOverwrite}
            disabled={disabled}
            className={classNames(
              editorClassName,
              multiLine && size === 'md' && 'py-1.5',
              multiLine && size === 'sm' && 'py-1',
            )}
            onFocus={handleFocus}
            onBlur={handleBlur}
            readOnly={readOnly}
            {...props}
          />
        </HStack>
        {type === 'password' && (
          <IconButton
            title={obscured ? `Show ${label}` : `Obscure ${label}`}
            size="xs"
            className={classNames(
              'mr-0.5 group/obscure !h-auto my-0.5',
              disabled && 'opacity-disabled',
            )}
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
