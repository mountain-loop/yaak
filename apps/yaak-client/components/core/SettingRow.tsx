import type { AnyModel } from "@yaakapp-internal/models";
import { patchModel } from "@yaakapp-internal/models";
import classNames from "classnames";
import type { ReactNode } from "react";
import { CopyIconButton } from "../CopyIconButton";
import { Checkbox } from "./Checkbox";
import { IconButton, type IconButtonProps } from "./IconButton";
import { PlainInput } from "./PlainInput";
import type { RadioDropdownItem } from "./RadioDropdown";
import { Select } from "./Select";
import { SelectFile } from "../SelectFile";

type ModelKeyOfValue<T, V> = {
  [K in keyof T]-?: T[K] extends V ? K : never;
}[keyof T];

type SettingRowBaseProps = {
  className?: string;
  controlClassName?: string;
  description?: ReactNode;
  disabled?: boolean;
  title: ReactNode;
};

export function SettingsList({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={classNames("w-full", className)}>{children}</div>;
}

export function SettingsSection({
  children,
  className,
  description,
  title,
}: {
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  title: ReactNode | null;
}) {
  const showHeader = title != null || description != null;

  return (
    <section className={classNames(className, "w-full")}>
      {showHeader && (
        <div className="border-b border-border-subtle pb-2">
          {title != null && <div className="text-text-subtle">{title}</div>}
          {description != null && <p className="mt-1 text-sm text-text-subtlest">{description}</p>}
        </div>
      )}
      <div className="[&>*:last-child]:border-b-0">{children}</div>
    </section>
  );
}

export function SettingRow({
  children,
  className,
  controlClassName,
  description,
  disabled,
  title,
}: {
  children: ReactNode;
} & SettingRowBaseProps) {
  return (
    <div
      aria-disabled={disabled || undefined}
      className={classNames(
        className,
        "@container border-b border-border-subtle py-4",
        disabled && "opacity-disabled",
      )}
    >
      <div
        className={classNames(
          "grid grid-cols-1 gap-2",
          "@[30rem]:grid-cols-[minmax(0,1fr)_auto] items-center",
        )}
      >
        <div className="min-w-0">
          <div className="text text-text">{title}</div>
          {description != null && (
            <div className="mt-1 max-w-2xl text-sm text-text-subtle">{description}</div>
          )}
        </div>
        <div
          className={classNames(
            "flex min-w-0 items-center justify-start @[40rem]:justify-end",
            controlClassName,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function SettingValue({
  actions,
  className,
  copyText,
  enableCopy = true,
  value,
}: {
  actions?: SettingValueAction[];
  className?: string;
  copyText?: string;
  enableCopy?: boolean;
  value: ReactNode;
}) {
  const textValue = typeof value === "string" || typeof value === "number" ? `${value}` : null;
  const textToCopy = copyText ?? textValue;

  return (
    <>
      <span
        className={classNames(
          className,
          "cursor-text select-text truncate font-mono text-editor text-text-subtle pr-1.5",
        )}
      >
        {value}
      </span>
      {actions?.map((action) => (
        <IconButton
          key={action.title}
          icon={action.icon}
          title={action.title}
          size="2xs"
          iconSize="sm"
          onClick={action.onClick}
        />
      ))}
      {enableCopy && textToCopy != null && (
        <CopyIconButton size="2xs" text={textToCopy} title="Copy value" />
      )}
    </>
  );
}

type SettingValueAction = {
  icon: IconButtonProps["icon"];
  onClick: () => void;
  title: string;
};

export function SettingRowBoolean({
  checked,
  checkboxSize = "md",
  onChange,
  title,
  ...props
}: {
  checked: boolean;
  checkboxSize?: "sm" | "md";
  onChange: (checked: boolean) => void;
} & SettingRowBaseProps) {
  return (
    <SettingRow title={title} {...props}>
      <Checkbox
        hideLabel
        size={checkboxSize}
        checked={checked}
        disabled={props.disabled}
        title={title}
        onChange={onChange}
      />
    </SettingRow>
  );
}

export function ModelSettingRowBoolean<M extends AnyModel, K extends ModelKeyOfValue<M, boolean>>({
  model,
  modelKey,
  ...props
}: {
  model: M;
  modelKey: K;
} & Omit<Parameters<typeof SettingRowBoolean>[0], "checked" | "onChange">) {
  return (
    <SettingRowBoolean
      checked={model[modelKey] as boolean}
      onChange={(value) => patchModel(model, { [modelKey]: value } as Partial<M>)}
      {...props}
    />
  );
}

export function SettingRowNumber({
  inputClassName,
  inputWidthClassName = "!w-48",
  name,
  onChange,
  placeholder,
  required,
  title,
  type = "number",
  validate,
  value,
  ...props
}: {
  inputClassName?: string;
  inputWidthClassName?: string;
  name: string;
  onChange: (value: number) => void;
  placeholder?: string;
  required?: boolean;
  type?: "number";
  validate?: (value: string) => boolean;
  value: number;
} & SettingRowBaseProps) {
  return (
    <SettingRow title={title} {...props}>
      <PlainInput
        required={required}
        hideLabel
        size="sm"
        name={name}
        label={typeof title === "string" ? title : name}
        placeholder={placeholder}
        defaultValue={`${value}`}
        validate={validate}
        onChange={(value) => onChange(Number.parseInt(value, 10) || 0)}
        type={type}
        className={inputClassName}
        containerClassName={inputWidthClassName}
        disabled={props.disabled}
      />
    </SettingRow>
  );
}

export function ModelSettingRowNumber<M extends AnyModel, K extends ModelKeyOfValue<M, number>>({
  model,
  modelKey,
  ...props
}: {
  model: M;
  modelKey: K;
} & Omit<Parameters<typeof SettingRowNumber>[0], "name" | "onChange" | "value">) {
  return (
    <SettingRowNumber
      name={String(modelKey)}
      value={model[modelKey] as number}
      onChange={(value) => patchModel(model, { [modelKey]: value } as Partial<M>)}
      {...props}
    />
  );
}

export function SettingRowText({
  inputClassName,
  inputWidthClassName = "!w-80",
  name,
  onChange,
  placeholder,
  required,
  title,
  type = "text",
  value,
  ...props
}: {
  inputClassName?: string;
  inputWidthClassName?: string;
  name: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: "text" | "password";
  value: string;
} & SettingRowBaseProps) {
  return (
    <SettingRow title={title} {...props}>
      <PlainInput
        required={required}
        hideLabel
        size="sm"
        name={name}
        label={typeof title === "string" ? title : name}
        placeholder={placeholder}
        defaultValue={value}
        onChange={onChange}
        type={type}
        className={inputClassName}
        containerClassName={inputWidthClassName}
        disabled={props.disabled}
      />
    </SettingRow>
  );
}

export function ModelSettingRowText<M extends AnyModel, K extends ModelKeyOfValue<M, string>>({
  model,
  modelKey,
  ...props
}: {
  model: M;
  modelKey: K;
} & Omit<Parameters<typeof SettingRowText>[0], "name" | "onChange" | "value">) {
  return (
    <SettingRowText
      name={String(modelKey)}
      value={model[modelKey] as string}
      onChange={(value) => patchModel(model, { [modelKey]: value } as Partial<M>)}
      {...props}
    />
  );
}

export function SettingRowFile({
  buttonClassName,
  controlClassName = "min-w-0 max-w-[min(32rem,45vw)]",
  directory,
  filePath,
  nameOverride,
  noun,
  onChange,
  size = "xs",
  title,
  ...props
}: {
  buttonClassName?: string;
  directory?: boolean;
  filePath: string | null;
  nameOverride?: string | null;
  noun?: string;
  onChange: (filePath: string | null) => void | Promise<void>;
  size?: Parameters<typeof SelectFile>[0]["size"];
} & SettingRowBaseProps) {
  return (
    <SettingRow title={title} controlClassName={controlClassName} {...props}>
      <SelectFile
        directory={directory}
        inline
        hideLabel
        label={typeof title === "string" ? title : noun}
        size={size}
        noun={noun}
        nameOverride={nameOverride}
        filePath={filePath}
        className={buttonClassName}
        onChange={({ filePath }) => onChange(filePath)}
      />
    </SettingRow>
  );
}

export function SettingRowDirectory({
  noun = "Directory",
  ...props
}: Omit<Parameters<typeof SettingRowFile>[0], "directory">) {
  return <SettingRowFile directory noun={noun} {...props} />;
}

export function SettingRowSelect<T extends string>({
  defaultValue,
  name,
  onChange,
  options,
  selectClassName = "!w-48",
  title,
  value,
  ...props
}: {
  defaultValue?: T;
  name: string;
  onChange: (value: T) => void;
  options: RadioDropdownItem<T>[];
  selectClassName?: string;
  value: T;
} & SettingRowBaseProps) {
  return (
    <SettingRow title={title} {...props}>
      <SettingSelectControl
        name={name}
        label={typeof title === "string" ? title : name}
        value={value}
        defaultValue={defaultValue}
        selectClassName={selectClassName}
        disabled={props.disabled}
        onChange={onChange}
        options={options}
      />
    </SettingRow>
  );
}

export function SettingSelectControl<T extends string>({
  defaultValue,
  disabled,
  label,
  name,
  onChange,
  options,
  selectClassName = "!w-48",
  value,
}: {
  defaultValue?: T;
  disabled?: boolean;
  label: string;
  name: string;
  onChange: (value: T) => void;
  options: RadioDropdownItem<T>[];
  selectClassName?: string;
  value: T;
}) {
  return (
    <Select
      hideLabel
      name={name}
      value={value}
      defaultValue={defaultValue}
      label={label}
      size="sm"
      className={selectClassName}
      disabled={disabled}
      onChange={onChange}
      options={options}
    />
  );
}

export function ModelSettingSelectControl<
  M extends AnyModel,
  K extends ModelKeyOfValue<M, string>,
  V extends M[K] & string,
>({
  model,
  modelKey,
  ...props
}: {
  model: M;
  modelKey: K;
} & Omit<Parameters<typeof SettingSelectControl<V>>[0], "name" | "onChange" | "value">) {
  return (
    <SettingSelectControl
      name={String(modelKey)}
      value={model[modelKey] as V}
      onChange={(value) => patchModel(model, { [modelKey]: value } as Partial<M>)}
      {...props}
    />
  );
}

export function ModelSettingRowSelect<
  M extends AnyModel,
  K extends ModelKeyOfValue<M, string>,
  V extends M[K] & string,
>({
  model,
  modelKey,
  ...props
}: {
  model: M;
  modelKey: K;
} & Omit<Parameters<typeof SettingRowSelect<V>>[0], "name" | "onChange" | "value">) {
  return (
    <SettingRowSelect
      name={String(modelKey)}
      value={model[modelKey] as V}
      onChange={(value) => patchModel(model, { [modelKey]: value } as Partial<M>)}
      {...props}
    />
  );
}

export function SettingOverrideRow({
  children,
  className,
  controlClassName,
  description,
  disabled,
  onResetOverride,
  overridden,
  resetTitle = "Reset override",
  title,
}: {
  children: ReactNode;
  className?: string;
  controlClassName?: string;
  description?: ReactNode;
  disabled?: boolean;
  onResetOverride: () => void;
  overridden: boolean;
  resetTitle?: string;
  title: ReactNode;
}) {
  return (
    <SettingRow
      className={className}
      controlClassName={controlClassName}
      description={description}
      disabled={disabled}
      title={
        <span className="inline-flex items-center gap-1.5">
          {title}
          {overridden && (
            <IconButton
              icon="undo_2"
              size="2xs"
              iconSize="sm"
              title={resetTitle}
              className="text-text-subtle"
              onClick={onResetOverride}
            />
          )}
        </span>
      }
    >
      {children}
    </SettingRow>
  );
}
