import classNames from 'classnames';
import type { EditorView } from 'codemirror';
import type { ReactNode } from 'react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useIsEncryptionEnabled } from '../../hooks/useIsEncryptionEnabled';
import { useStateWithDeps } from '../../hooks/useStateWithDeps';
import {
  analyzeTemplateForEncryption,
  convertTemplateToInsecure,
  convertTemplateToSecure,
} from '../../lib/encryption';
import { generateId } from '../../lib/generateId';
import { withEncryptionEnabled } from '../../lib/setupOrConfigureEncryption';
import type { DropdownItem } from './Dropdown';
import { Dropdown } from './Dropdown';
import type { EditorProps } from './Editor/Editor';
import { Editor } from './Editor/Editor';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { Label } from './Label';
import { HStack } from './Stacks';

export type InputProps = Pick<
  EditorProps,
  | 'language'
  | 'autocomplete'
  | 'forceUpdateKey'
  | 'disabled'
  | 'autoFocus'
  | 'autoSelect'
  | 'autocompleteVariables'
  | 'autocompleteFunctions'
  | 'onKeyDown'
  | 'readOnly'
> & {
  className?: string;
  containerClassName?: string;
  defaultValue?: string | null;
  disableObscureToggle?: boolean;
  fullHeight?: boolean;
  hideLabel?: boolean;
  inputWrapperClassName?: string;
  label: ReactNode;
  labelClassName?: string;
  labelPosition?: 'top' | 'left';
  leftSlot?: ReactNode;
  multiLine?: boolean;
  name?: string;
  onBlur?: () => void;
  onChange?: (value: string) => void;
  onFocus?: () => void;
  onPaste?: (value: string) => void;
  onPasteOverwrite?: EditorProps['onPasteOverwrite'];
  placeholder?: string;
  required?: boolean;
  rightSlot?: ReactNode;
  size?: 'xs' | 'sm' | 'md' | 'auto';
  stateKey: EditorProps['stateKey'];
  tint?: 'primary' | 'info' | 'warning';
  type?: 'text' | 'password';
  validate?: boolean | ((v: string) => boolean);
  wrapLines?: boolean;
};

export const Input = forwardRef<EditorView, InputProps>(function Input({ type, ...props }, ref) {
  // If it's a password and template functions are supported (ie. secure(...)) then
  // use the encrypted input component.
  if (type === 'password' && props.autocompleteFunctions) {
    return <EncryptionInput {...props} />;
  } else {
    return <BaseInput ref={ref} type={type} {...props} />;
  }
});

const BaseInput = forwardRef<EditorView, InputProps>(function InputBase(
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
    disableObscureToggle,
    tint,
    validate,
    readOnly,
    stateKey,
    multiLine,
    disabled,
    ...props
  }: InputProps,
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [obscured, setObscured] = useStateWithDeps(type === 'password', [type]);
  const [hasChanged, setHasChanged] = useStateWithDeps<boolean>(false, [forceUpdateKey]);
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
    if (required && !validateRequire(defaultValue ?? '')) return false;
    if (typeof validate === 'boolean') return validate;
    if (typeof validate === 'function' && !validate(defaultValue ?? '')) return false;
    return true;
  }, [required, defaultValue, validate]);

  const handleChange = useCallback(
    (value: string) => {
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
          'relative w-full rounded-md text overflow-hidden',
          'border',
          focused && !disabled ? 'border-border-focus' : 'border-border',
          disabled && 'border-dotted',
          !isValid && hasChanged && '!border-danger',
          size === 'md' && 'min-h-md',
          size === 'sm' && 'min-h-sm',
          size === 'xs' && 'min-h-xs',
        )}
      >
        {tint != null && (
          <div
            aria-hidden
            className={classNames(
              'absolute inset-0 opacity-5 pointer-events-none',
              tint === 'info' && 'bg-info',
              tint === 'warning' && 'bg-warning',
              tint === 'primary' && 'bg-primary',
            )}
          />
        )}
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
        {type === 'password' && !disableObscureToggle && (
          <IconButton
            title={obscured ? `Show ${label}` : `Obscure ${label}`}
            size="xs"
            className={classNames(
              'mr-0.5 group/obscure !h-auto my-0.5',
              disabled && 'opacity-disabled',
            )}
            iconClassName={classNames(
              'group-hover/obscure:text',
              tint === 'info' && 'text-info',
              tint === 'warning' && 'text-warning',
              tint === 'primary' && 'text-primary',
            )}
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

type PasswordFieldType = 'text' | 'encrypted';

function EncryptionInput({
  defaultValue,
  onChange,
  autocompleteFunctions,
  autocompleteVariables,
  forceUpdateKey: ogForceUpdateKey,
  ...props
}: Omit<InputProps, 'type'>) {
  const isEncryptionEnabled = useIsEncryptionEnabled();
  const [state, setState] = useStateWithDeps<{
    fieldType: PasswordFieldType;
    value: string | null;
    obscured: boolean;
  }>({ fieldType: 'encrypted', value: null, obscured: true }, [
    ogForceUpdateKey,
    isEncryptionEnabled,
  ]);

  const forceUpdateKey = `${ogForceUpdateKey}::${state?.fieldType}::${state.value === null}`;

  const containsPlainText = useMemo(() => {
    if (state.fieldType === 'encrypted') {
      return false;
    } else {
      return analyzeTemplateForEncryption(state.value ?? '').containsPlainText;
    }
  }, [state.fieldType, state.value]);

  useEffect(() => {
    if (state.value != null) {
      // We already configured it
      return;
    }

    if (analyzeTemplateForEncryption(defaultValue ?? '').onlySecureTag) {
      // Lazily update value to decrypted representation
      convertTemplateToInsecure(defaultValue ?? '').then((value) => {
        setState({ fieldType: 'encrypted', value, obscured: true });
      });
    } else if (isEncryptionEnabled && !defaultValue) {
      // Default to encrypted field for new encrypted inputs
      setState({ fieldType: 'encrypted', value: '', obscured: true });
    } else {
      // Don't obscure plain text when encryption is enabled
      setState({ fieldType: 'text', value: defaultValue ?? '', obscured: false });
    }
  }, [defaultValue, isEncryptionEnabled, setState, state.value]);

  const handleChange = useCallback(
    (value: string, fieldType: PasswordFieldType) => {
      if (fieldType === 'encrypted') {
        convertTemplateToSecure(value).then((value) => onChange?.(value));
      } else {
        onChange?.(value);
      }
      setState((s) => {
        let obscured = s.obscured;
        if (s.fieldType !== fieldType && fieldType === 'encrypted') {
          // Obscure if we're going from text -> encrypted
          obscured = true;
        }
        return { value, fieldType, obscured };
      });
    },
    [onChange, setState],
  );

  const handleInputChange = useCallback(
    (value: string) => {
      if (state.fieldType != null) {
        handleChange(value, state.fieldType);
      }
    },
    [handleChange, state],
  );

  const handleFieldTypeChange = useCallback(
    (newFieldType: PasswordFieldType) => {
      const { value, fieldType } = state;
      if (value == null || fieldType === newFieldType) {
        return;
      }

      withEncryptionEnabled(async () => {
        const newValue = await convertTemplateToInsecure(value);
        handleChange(newValue, newFieldType);
      });
    },
    [handleChange, state],
  );

  const dropdownItems = useMemo<DropdownItem[]>(
    () => [
      {
        label: state.obscured ? 'Reveal text' : 'Conceal text',
        disabled: !isEncryptionEnabled || state.fieldType === 'text',
        leftSlot: <Icon icon={state.obscured ? 'eye' : 'eye_closed'} />,
        onSelect: () => setState((s) => ({ ...s, obscured: !s.obscured })),
      },
      {
        label: state.fieldType === 'text' ? 'Encrypt Value' : 'Decrypt Value',
        leftSlot: <Icon icon={state.fieldType === 'text' ? 'lock' : 'lock_open'} />,
        onSelect: () => handleFieldTypeChange(state.fieldType === 'text' ? 'encrypted' : 'text'),
      },
    ],
    [handleFieldTypeChange, isEncryptionEnabled, setState, state.fieldType, state.obscured],
  );

  let tint: InputProps['tint'];
  if (!isEncryptionEnabled) {
    tint = undefined;
  } else if (isEncryptionEnabled && state.fieldType === 'encrypted') {
    tint = 'info';
  } else if (!containsPlainText) {
    tint = 'primary';
  } else {
    tint = 'warning';
  }

  return (
    <BaseInput
      disableObscureToggle
      autocompleteFunctions={autocompleteFunctions}
      autocompleteVariables={autocompleteVariables}
      onChange={handleInputChange}
      defaultValue={state.value ?? ''}
      tint={tint}
      type={
        !isEncryptionEnabled
          ? 'text'
          : state.fieldType === 'encrypted' && state.obscured
            ? 'password'
            : 'text'
      }
      forceUpdateKey={forceUpdateKey}
      rightSlot={
        <HStack className="h-auto my-0.5">
          <Dropdown items={dropdownItems}>
            <IconButton
              size="xs"
              iconSize="sm"
              title="Configure encryption"
              icon={state.fieldType === 'encrypted' ? 'lock' : 'lock_open'}
              className={classNames(
                '!h-full mr-0.5 opacity-70',
                props.disabled && '!opacity-disabled',
              )}
              iconClassName={classNames(
                tint === 'info' && '!text-info',
                tint === 'warning' && '!text-warning',
                tint === 'primary' && '!text-primary',
              )}
            />
          </Dropdown>
        </HStack>
      }
      {...props}
    />
  );
}
