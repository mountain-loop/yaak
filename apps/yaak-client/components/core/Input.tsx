import {
  HStack,
  Icon,
  type IconProps,
  IconTooltip,
  Input as BaseUiInput,
  type InputHandle,
  type InputProps as BaseUiInputProps,
  useStateWithDeps,
} from "@yaakapp-internal/ui";
import type { CodeEditorProps } from "@yaakapp-internal/ui/editor";
import classNames from "classnames";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { createFastMutation } from "../../hooks/useFastMutation";
import { useIsEncryptionEnabled } from "../../hooks/useIsEncryptionEnabled";
import { copyToClipboard } from "../../lib/copy";
import {
  analyzeTemplate,
  convertTemplateToInsecure,
  convertTemplateToSecure,
} from "../../lib/encryption";
import {
  setupOrConfigureEncryption,
  withEncryptionEnabled,
} from "../../lib/setupOrConfigureEncryption";
import { Button } from "./Button";
import type { DropdownItem } from "./Dropdown";
import { Dropdown } from "./Dropdown";
import type { EditorProps } from "./Editor/Editor";
import type { GenericCompletion } from "./Editor/genericCompletion";
import { Editor } from "./Editor/LazyEditor";
import { IconButton } from "./IconButton";

export type { InputHandle };

export type InputProps = Omit<
  BaseUiInputProps,
  "language" | "extensions" | "renderEditor" | "renderOptionsPicker"
> &
  Pick<
    EditorProps,
    | "language"
    | "autocomplete"
    | "forcedEnvironmentId"
    | "autocompleteVariables"
    | "autocompleteFunctions"
    | "extraExtensions"
  > & {
    /**
     * Show a chevron that opens the `autocomplete` options as a menu, so a value can be picked
     * without knowing what to type. Opt-in, because plenty of inputs pass `autocomplete` without
     * wanting the affordance (the URL bar completes from history, and a chevron there would be
     * noise). Renders nothing when there are no options to show.
     */
    showOptionsPicker?: boolean;
  };

export function Input({ type, ...props }: InputProps) {
  // If it's a password and template functions are supported (ie. secure(...)) then
  // use the encrypted input component.
  if (type === "password" && props.autocompleteFunctions) {
    return <EncryptionInput {...props} />;
  }
  return <BaseInput type={type} {...props} />;
}

function BaseInput({
  autocomplete,
  autocompleteFunctions,
  autocompleteVariables,
  extraExtensions,
  forcedEnvironmentId,
  language,
  showOptionsPicker,
  ...props
}: InputProps) {
  const renderEditor = useCallback(
    (editorProps: CodeEditorProps) => (
      <Editor
        {...editorProps}
        language={language}
        autocomplete={autocomplete}
        autocompleteFunctions={autocompleteFunctions}
        autocompleteVariables={autocompleteVariables}
        extraExtensions={extraExtensions}
        forcedEnvironmentId={forcedEnvironmentId}
      />
    ),
    [
      language,
      autocomplete,
      autocompleteFunctions,
      autocompleteVariables,
      extraExtensions,
      forcedEnvironmentId,
    ],
  );

  const pickerOptions = showOptionsPicker && !props.disabled ? (autocomplete?.options ?? []) : [];
  const renderOptionsPicker =
    pickerOptions.length > 0
      ? (insert: (value: string) => void) => (
          <OptionsPickerDropdown options={pickerOptions} onSelect={insert} />
        )
      : undefined;

  return (
    <BaseUiInput {...props} renderEditor={renderEditor} renderOptionsPicker={renderOptionsPicker} />
  );
}

/**
 * Chevron that opens the input's autocomplete options as a menu, for browsing values rather than
 * typing them. Shows `label` but inserts `apply` when set, so a long value can be listed under a
 * short name (e.g. a User-Agent).
 *
 * Skipped in the tab order: once focus is in the input, inline autocomplete offers the same
 * options, so this would only add a stop between fields. Hidden when the nearest container is
 * narrow and the input needs the width more — written as a `max` query so it stays visible for
 * inputs that have no container ancestor at all.
 */
function OptionsPickerDropdown({
  options,
  onSelect,
}: {
  options: GenericCompletion[];
  onSelect: (value: string) => void;
}) {
  const items = useMemo<DropdownItem[]>(
    () =>
      options.map((o) => ({
        label: o.label,
        onSelect: () => onSelect(typeof o.apply === "string" ? o.apply : o.label),
      })),
    [options, onSelect],
  );

  return (
    <Dropdown items={items}>
      <IconButton
        tabIndex={-1}
        iconSize="sm"
        size="xs"
        icon="chevron_down"
        title="Show suggestions"
        className="mr-0.5 h-auto! my-0.5 text-text-subtlest @max-[24rem]:hidden"
      />
    </Dropdown>
  );
}

type PasswordFieldType = "text" | "encrypted";

function EncryptionInput({
  defaultValue,
  onChange,
  autocompleteFunctions,
  autocompleteVariables,
  forceUpdateKey: ogForceUpdateKey,
  setRef,
  ...props
}: InputProps) {
  const isEncryptionEnabled = useIsEncryptionEnabled();
  const [state, setState] = useStateWithDeps<{
    fieldType: PasswordFieldType;
    value: string | null;
    security: ReturnType<typeof analyzeTemplate> | null;
    obscured: boolean;
    error: string | null;
  }>(
    {
      fieldType: isEncryptionEnabled ? "encrypted" : "text",
      value: null,
      security: null,
      obscured: true,
      error: null,
    },
    [ogForceUpdateKey],
  );

  const forceUpdateKey = `${ogForceUpdateKey}::${state.fieldType}::${state.value === null}`;
  const inputRef = useRef<InputHandle>(null);

  useEffect(() => {
    if (state.value != null) {
      // We already configured it
      return;
    }

    const security = analyzeTemplate(defaultValue ?? "");
    if (analyzeTemplate(defaultValue ?? "") === "global_secured") {
      // Lazily update value to decrypted representation
      templateToInsecure.mutate(defaultValue ?? "", {
        onSuccess: (value) => {
          setState({ fieldType: "encrypted", security, value, obscured: true, error: null });
          // We're calling this here because we want the input to be fully initialized so the caller
          // can do stuff like change the selection.
          requestAnimationFrame(() => setRef?.(inputRef.current));
        },
        onError: (value) => {
          setState({
            fieldType: "encrypted",
            security,
            value: null,
            error: String(value),
            obscured: true,
          });
        },
      });
    } else if (isEncryptionEnabled && !defaultValue) {
      // Default to encrypted field for new encrypted inputs
      setState({ fieldType: "encrypted", security, value: "", obscured: true, error: null });
      requestAnimationFrame(() => setRef?.(inputRef.current));
    } else if (isEncryptionEnabled) {
      // Don't obscure plain text when encryption is enabled
      setState({
        fieldType: "text",
        security,
        value: defaultValue ?? "",
        obscured: false,
        error: null,
      });
      requestAnimationFrame(() => setRef?.(inputRef.current));
    } else {
      // Don't obscure plain text when encryption is disabled
      setState({
        fieldType: "text",
        security,
        value: defaultValue ?? "",
        obscured: true,
        error: null,
      });
      requestAnimationFrame(() => setRef?.(inputRef.current));
    }
  }, [defaultValue, isEncryptionEnabled, setRef, setState, state.value]);

  const handleChange = useCallback(
    (value: string, fieldType: PasswordFieldType) => {
      if (fieldType === "encrypted") {
        templateToSecure.mutate(value, { onSuccess: (value) => onChange?.(value) });
      } else {
        onChange?.(value);
      }
      setState((s) => {
        // We can't analyze when encrypted because we don't have the raw value, so assume it's secured
        const security = fieldType === "encrypted" ? "global_secured" : analyzeTemplate(value);
        // Reset obscured value when the field type is being changed
        const obscured = fieldType === s.fieldType ? s.obscured : fieldType !== "text";
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

  const setInputRef = useCallback((h: InputHandle | null) => {
    inputRef.current = h;
  }, []);

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
        label: state.obscured ? "Show" : "Hide",
        disabled: isEncryptionEnabled && state.fieldType === "text",
        leftSlot: <Icon icon={state.obscured ? "eye" : "eye_closed"} />,
        onSelect: () => setState((s) => ({ ...s, obscured: !s.obscured })),
      },
      {
        label: "Copy",
        leftSlot: <Icon icon="copy" />,
        hidden: !state.value,
        onSelect: () => copyToClipboard(state.value ?? ""),
      },
      { type: "separator" },
      {
        label: state.fieldType === "text" ? "Encrypt Field" : "Decrypt Field",
        leftSlot: <Icon icon={state.fieldType === "text" ? "lock" : "lock_open"} />,
        onSelect: () => handleFieldTypeChange(state.fieldType === "text" ? "encrypted" : "text"),
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

  let tint: InputProps["tint"];
  if (!isEncryptionEnabled) {
    tint = undefined;
  } else if (state.fieldType === "encrypted") {
    tint = "info";
  } else if (state.security === "local_secured") {
    tint = "secondary";
  } else if (state.security === "insecure") {
    tint = "notice";
  }

  const rightSlot = useMemo(() => {
    let icon: IconProps["icon"];
    if (isEncryptionEnabled) {
      icon = state.security === "insecure" ? "shield_off" : "shield_check";
    } else {
      icon = state.obscured ? "eye_closed" : "eye";
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
              "flex items-center justify-center h-full! px-1!",
              "opacity-70", // Makes it a bit subtler
              props.disabled && "opacity-disabled!",
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

  const type = state.obscured ? "password" : "text";

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
        {state.error.replace(/^Render Error: /i, "")}
      </Button>
    );
  }

  return (
    <BaseInput
      setRef={setInputRef}
      disableObscureToggle
      autocompleteFunctions={autocompleteFunctions}
      autocompleteVariables={autocompleteVariables}
      defaultValue={state.value ?? ""}
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
  mutationKey: ["template-to-secure"],
  mutationFn: convertTemplateToSecure,
});

const templateToInsecure = createFastMutation({
  mutationKey: ["template-to-insecure"],
  mutationFn: convertTemplateToInsecure,
  disableToastError: true,
});
