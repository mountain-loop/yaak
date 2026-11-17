import type { AnyModel } from "@yaakapp-internal/models";
import { patchModel } from "@yaakapp-internal/models";
import {
  SettingRow,
  type SettingRowBaseProps,
  SettingRowBoolean,
  SettingRowNumber,
  SettingRowSelect,
  SettingRowText,
  SettingSelectControl,
} from "@yaakapp-internal/ui";
import { SelectFile } from "../SelectFile";

export type { SettingRowBaseProps, SettingSnippetLanguage } from "@yaakapp-internal/ui";
export {
  SettingCommand,
  SettingOverrideRow,
  SettingRow,
  SettingRowBoolean,
  SettingRowNumber,
  SettingRowSelect,
  SettingRowText,
  SettingSelectControl,
  SettingSnippet,
  SettingsList,
  SettingsSection,
  SettingValue,
} from "@yaakapp-internal/ui";

type ModelKeyOfValue<T, V> = {
  [K in keyof T]-?: T[K] extends V ? K : never;
}[keyof T];

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
