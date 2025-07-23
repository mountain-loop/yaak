import type { EditorView } from '@codemirror/view';
import type { Color } from '@yaakapp/api';
import classNames from 'classnames';
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
import { createFastMutation } from '../../hooks/useFastMutation';
import { useIsEncryptionEnabled } from '../../hooks/useIsEncryptionEnabled';
import { useStateWithDeps } from '../../hooks/useStateWithDeps';
import { copyToClipboard } from '../../lib/copy';
import {
  analyzeTemplate,
  convertTemplateToInsecure,
  convertTemplateToSecure,
} from '../../lib/encryption';
import { generateId } from '../../lib/generateId';
import {
  setupOrConfigureEncryption,
  withEncryptionEnabled,
} from '../../lib/setupOrConfigureEncryption';
import { Button } from './Button';
import type { DropdownItem } from './Dropdown';
import { Dropdown } from './Dropdown';
import type { EditorProps } from './Editor/Editor';
import { Editor } from './Editor/Editor';
import type { IconProps } from './Icon';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { IconTooltip } from './IconTooltip';
import { Label } from './Label';
import { HStack } from './Stacks';

export type InputProps = Pick<
  EditorProps,
  | 'language'
  | 'autocomplete'
  | 'forcedEnvironmentId'
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
  inputWrapperClassName?: string;
  defaultValue?: string | null;
  disableObscureToggle?: boolean;
  fullHeight?: boolean;
  hideLabel?: boolean;
  help?: ReactNode;
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
  size?: '2xs' | 'xs' | 'sm' | 'md' | 'auto';
  stateKey: EditorProps['stateKey'];
  tint?: Color;
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
    defaultValue,
    disableObscureToggle,
    disabled,
    forceUpdateKey,
    fullHeight,
    help,
    hideLabel,
    inputWrapperClassName,
    label,
    labelClassName,
    labelPosition = 'top',
    leftSlot,
    multiLine,
    onBlur,
    onChange,
    onFocus,
    onPaste,
    onPasteOverwrite,
    placeholder,
    readOnly,
    required,
    rightSlot,
    size = 'md',
    stateKey,
    tint,
    type = 'text',
    validate,
    wrapLines,
    ...props
  }: InputProps,
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [obscured, setObscured] = useStateWithDeps(type === 'password', [type]);
  const [hasChanged, setHasChanged] = useStateWithDeps<boolean>(false, [forceUpdateKey]);
  const editorRef = useRef<EditorView | null>(null);

  useImperativeHandle<EditorView | null, EditorView | null>(ref, () => editorRef.current);

  const lastWindowFocus = useRef<number>(0);
  useEffect(() => {
    const fn = () => (lastWindowFocus.current = Date.now());
    window.addEventListener('focus', fn);
    return () => {
      window.removeEventListener('focus', fn);
    };
  }, []);

  const handleFocus = useCallback(() => {
    if (readOnly) return;

    // Select all text of input when it's focused to match standard browser behavior.
    // This should not, however, select when the input is focused due to a window focus event, so
    // we handle that case as well.
    const windowJustFocused = Date.now() - lastWindowFocus.current < 200;
    if (!windowJustFocused) {
      editorRef.current?.dispatch({
        selection: { anchor: 0, head: editorRef.current.state.doc.length },
      });
    }

    setFocused(true);
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
        help={help}
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
          size === '2xs' && 'min-h-2xs',
        )}
      >
        {tint != null && (
          <div
            aria-hidden
            className={classNames(
              'absolute inset-0 opacity-5 pointer-events-none',
              tint === 'primary' && 'bg-primary',
              tint === 'secondary' && 'bg-secondary',
              tint === 'info' && 'bg-info',
              tint === 'success' && 'bg-success',
              tint === 'notice' && 'bg-notice',
              tint === 'warning' && 'bg-warning',
              tint === 'danger' && 'bg-danger',
            )}
          />
        )}
        {leftSlot}
        <HStack
          className={classNames(
            inputWrapperClassName,
            'w-full min-w-0 px-2',
            fullHeight && 'h-full',
            leftSlot ? 'pl-0.5 -ml-2' : null,
            rightSlot ? 'pr-0.5 -mr-2' : null,
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
            className={classNames('mr-0.5 !h-auto my-0.5', disabled && 'opacity-disabled')}
            color={tint}
            // iconClassName={classNames(
            //   tint === 'primary' && 'text-primary',
            //   tint === 'secondary' && 'text-secondary',
            //   tint === 'info' && 'text-info',
            //   tint === 'success' && 'text-success',
            //   tint === 'notice' && 'text-notice',
            //   tint === 'warning' && 'text-warning',
            //   tint === 'danger' && 'text-danger',
            // )}
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
    security: ReturnType<typeof analyzeTemplate> | null;
    obscured: boolean;
    error: string | null;
  }>({ fieldType: 'encrypted', value: null, security: null, obscured: true, error: null }, [
    ogForceUpdateKey,
  ]);

  const forceUpdateKey = `${ogForceUpdateKey}::${state.fieldType}::${state.value === null}`;

  useEffect(() => {
    if (state.value != null) {
      // We already configured it
      return;
    }

    const security = analyzeTemplate(defaultValue ?? '');
    if (analyzeTemplate(defaultValue ?? '') === 'global_secured') {
      // Lazily update value to decrypted representation
      templateToInsecure.mutate(defaultValue ?? '', {
        onSuccess: (value) => {
          setState({ fieldType: 'encrypted', security, value, obscured: true, error: null });
        },
        onError: (value) => {
          setState({
            fieldType: 'encrypted',
            security,
            value: null,
            error: String(value),
            obscured: true,
          });
        },
      });
    } else if (isEncryptionEnabled && !defaultValue) {
      // Default to encrypted field for new encrypted inputs
      setState({ fieldType: 'encrypted', security, value: '', obscured: true, error: null });
    } else if (isEncryptionEnabled) {
      // Don't obscure plain text when encryption is enabled
      setState({
        fieldType: 'text',
        security,
        value: defaultValue ?? '',
        obscured: false,
        error: null,
      });
    } else {
      // Don't obscure plain text when encryption is disabled
      setState({
        fieldType: 'text',
        security,
        value: defaultValue ?? '',
        obscured: true,
        error: null,
      });
    }
  }, [defaultValue, isEncryptionEnabled, setState, state.value]);

  const handleChange = useCallback(
    (value: string, fieldType: PasswordFieldType) => {
      if (fieldType === 'encrypted') {
        templateToSecure.mutate(value, { onSuccess: (value) => onChange?.(value) });
      } else {
        onChange?.(value);
      }
      setState((s) => {
        // We can't analyze when encrypted because we don't have the raw value, so assume it's secured
        const security = fieldType === 'encrypted' ? 'global_secured' : analyzeTemplate(value);
        // Reset obscured value when the field type is being changed
        const obscured = fieldType === s.fieldType ? s.obscured : fieldType !== 'text';
        return { fieldType, value, security, obscured, error: s.error };
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
        label: state.obscured ? 'Reveal' : 'Conceal',
        disabled: isEncryptionEnabled && state.fieldType === 'text',
        leftSlot: <Icon icon={state.obscured ? 'eye' : 'eye_closed'} />,
        onSelect: () => setState((s) => ({ ...s, obscured: !s.obscured })),
      },
      {
        label: 'Copy',
        leftSlot: <Icon icon="copy" />,
        hidden: !state.value,
        onSelect: () => copyToClipboard(state.value ?? ''),
      },
      { type: 'separator' },
      {
        label: state.fieldType === 'text' ? 'Encrypt Field' : 'Decrypt Field',
        leftSlot: <Icon icon={state.fieldType === 'text' ? 'lock' : 'lock_open'} />,
        onSelect: () => handleFieldTypeChange(state.fieldType === 'text' ? 'encrypted' : 'text'),
      },
    ],
    [
      handleFieldTypeChange,
      isEncryptionEnabled,
      setState,
      state.fieldType,
      state.obscured,
      state.value,
    ],
  );

  let tint: InputProps['tint'];
  if (!isEncryptionEnabled) {
    tint = undefined;
  } else if (state.fieldType === 'encrypted') {
    tint = 'info';
  } else if (state.security === 'local_secured') {
    tint = 'secondary';
  } else if (state.security === 'insecure') {
    tint = 'notice';
  }

  const rightSlot = useMemo(() => {
    let icon: IconProps['icon'];
    if (isEncryptionEnabled) {
      icon = state.security === 'insecure' ? 'shield_off' : 'shield_check';
    } else {
      icon = state.obscured ? 'eye_closed' : 'eye';
    }
    return (
      <HStack className="h-auto m-0.5">
        <Dropdown items={dropdownItems}>
          <Button
            size="sm"
            variant="border"
            color={tint}
            aria-label="Configure encryption"
            className={classNames(
              'flex items-center justify-center !h-full !px-1',
              'opacity-70', // Makes it a bit subtler
              props.disabled && '!opacity-disabled',
            )}
          >
            <HStack space={0.5}>
              <Icon size="sm" title="Configure encryption" icon={icon} />
              <Icon size="xs" title="Configure encryption" icon="chevron_down" />
            </HStack>
          </Button>
        </Dropdown>
      </HStack>
    );
  }, [dropdownItems, isEncryptionEnabled, props.disabled, state.obscured, state.security, tint]);

  const type = state.obscured ? 'password' : 'text';

  if (state.error) {
    return (
      <Button
        variant="border"
        color="danger"
        size={props.size}
        className="text-sm"
        rightSlot={<IconTooltip tabIndex={-1} content={state.error} icon="alert_triangle" />}
        onClick={() => {
          setupOrConfigureEncryption();
        }}
      >
        {state.error.replace(/^Render Error: /i, '')}
      </Button>
    );
  }

  return (
    <BaseInput
      disableObscureToggle
      autocompleteFunctions={autocompleteFunctions}
      autocompleteVariables={autocompleteVariables}
      defaultValue={state.value ?? ''}
      forceUpdateKey={forceUpdateKey}
      onChange={handleInputChange}
      tint={tint}
      type={type}
      rightSlot={rightSlot}
      disabled={state.error != null}
      className="pr-1.5" // To account for encryption dropdown
      {...props}
    />
  );
}

const templateToSecure = createFastMutation({
  mutationKey: ['template-to-secure'],
  mutationFn: convertTemplateToSecure,
});

const templateToInsecure = createFastMutation({
  mutationKey: ['template-to-insecure'],
  mutationFn: convertTemplateToInsecure,
  disableToastError: true,
});
