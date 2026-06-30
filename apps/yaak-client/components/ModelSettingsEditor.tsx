import type {
  Folder,
  GrpcRequest,
  HttpRequest,
  InheritedBoolSetting,
  InheritedIntSetting,
  WebsocketRequest,
  Workspace,
} from "@yaakapp-internal/models";
import { patchModel } from "@yaakapp-internal/models";
import { useModelAncestors } from "../hooks/useModelAncestors";
import {
  modelSupportsSetting,
  type RequestSettingDefinition,
  SETTING_FOLLOW_REDIRECTS,
  SETTING_REQUEST_MESSAGE_SIZE,
  SETTING_REQUEST_TIMEOUT,
  SETTING_SEND_COOKIES,
  SETTING_STORE_COOKIES,
  SETTING_VALIDATE_CERTIFICATES,
} from "../lib/requestSettings";
import { Checkbox } from "./core/Checkbox";
import { PlainInput } from "./core/PlainInput";
import {
  SettingOverrideRow,
  SettingRow,
  SettingRowBoolean,
  SettingsList,
  SettingsSection,
} from "./core/SettingRow";

const BYTES_PER_MB = 1024 * 1024;
const MAX_REQUEST_MESSAGE_SIZE_BYTES = 2_147_483_647;
const MAX_MESSAGE_SIZE_MB = MAX_REQUEST_MESSAGE_SIZE_BYTES / BYTES_PER_MB;

interface Props {
  showSectionTitles?: boolean;
  model: ModelWithSettings;
}

type ModelWithSettings =
  | Workspace
  | Folder
  | HttpRequest
  | WebsocketRequest
  | GrpcRequest;
type ModelWithHttpSettings = Workspace | Folder | HttpRequest;
type ModelWithTlsSettings =
  | Workspace
  | Folder
  | HttpRequest
  | WebsocketRequest
  | GrpcRequest;
type ModelWithCookieSettings =
  | Workspace
  | Folder
  | HttpRequest
  | WebsocketRequest;
type ModelWithMessageSizeSettings =
  | Workspace
  | Folder
  | WebsocketRequest
  | GrpcRequest;
type BooleanSetting = boolean | InheritedBoolSetting;
type IntegerSetting = number | InheritedIntSetting;
type CookieSettingsPatch = {
  settingSendCookies?: ModelWithCookieSettings["settingSendCookies"];
  settingStoreCookies?: ModelWithCookieSettings["settingStoreCookies"];
};
type HttpSettingsPatch = {
  settingFollowRedirects?: ModelWithHttpSettings["settingFollowRedirects"];
  settingRequestTimeout?: ModelWithHttpSettings["settingRequestTimeout"];
};
type TlsSettingsPatch = {
  settingValidateCertificates?: ModelWithTlsSettings["settingValidateCertificates"];
};
type MessageSizeSettingsPatch = {
  settingRequestMessageSize?: ModelWithMessageSizeSettings["settingRequestMessageSize"];
};

export function ModelSettingsEditor({
  model,
  showSectionTitles = false,
}: Props) {
  const ancestors = useModelAncestors(model);
  const supportsHttpSettings = modelSupportsHttpSettings(model);
  const supportsCookieSettings = modelSupportsCookieSettings(model);
  const supportsTlsSettings = modelSupportsTlsSettings(model);
  const supportsMessageSizeSettings = modelSupportsMessageSizeSettings(model);

  return (
    <SettingsList className="space-y-8">
      {supportsTlsSettings && (
        <SettingsSection title={showSectionTitles ? "Requests" : null}>
          {supportsHttpSettings && (
            <IntegerSettingRow
              settingDefinition={SETTING_REQUEST_TIMEOUT}
              setting={model.settingRequestTimeout}
              inheritedValue={resolveInheritedValue(
                ancestors,
                SETTING_REQUEST_TIMEOUT.modelKey,
                model.settingRequestTimeout,
              )}
              onChange={(settingRequestTimeout) =>
                patchHttpSettings(model, {
                  settingRequestTimeout,
                })
              }
            />
          )}
          {supportsMessageSizeSettings && (
            <MessageSizeSettingRow
              settingDefinition={SETTING_REQUEST_MESSAGE_SIZE}
              setting={model.settingRequestMessageSize}
              inheritedValue={resolveInheritedValue(
                ancestors,
                SETTING_REQUEST_MESSAGE_SIZE.modelKey,
                model.settingRequestMessageSize,
              )}
              onChange={(settingRequestMessageSize) =>
                patchMessageSizeSettings(model, {
                  settingRequestMessageSize,
                })
              }
            />
          )}
          <BooleanSettingRow
            settingDefinition={SETTING_VALIDATE_CERTIFICATES}
            setting={model.settingValidateCertificates}
            inheritedValue={resolveInheritedValue(
              ancestors,
              SETTING_VALIDATE_CERTIFICATES.modelKey,
              model.settingValidateCertificates,
            )}
            onChange={(settingValidateCertificates) =>
              patchTlsSettings(model, {
                settingValidateCertificates,
              })
            }
          />
          {supportsHttpSettings && (
            <BooleanSettingRow
              settingDefinition={SETTING_FOLLOW_REDIRECTS}
              setting={model.settingFollowRedirects}
              inheritedValue={resolveInheritedValue(
                ancestors,
                SETTING_FOLLOW_REDIRECTS.modelKey,
                model.settingFollowRedirects,
              )}
              onChange={(settingFollowRedirects) =>
                patchHttpSettings(model, {
                  settingFollowRedirects,
                })
              }
            />
          )}
        </SettingsSection>
      )}
      {supportsCookieSettings && (
        <SettingsSection
          title={supportsTlsSettings || showSectionTitles ? "Cookies" : null}
        >
          <BooleanSettingRow
            settingDefinition={SETTING_SEND_COOKIES}
            setting={model.settingSendCookies}
            inheritedValue={resolveInheritedValue(
              ancestors,
              SETTING_SEND_COOKIES.modelKey,
              model.settingSendCookies,
            )}
            onChange={(settingSendCookies) =>
              patchCookieSettings(model, {
                settingSendCookies,
              })
            }
          />
          <BooleanSettingRow
            settingDefinition={SETTING_STORE_COOKIES}
            setting={model.settingStoreCookies}
            inheritedValue={resolveInheritedValue(
              ancestors,
              SETTING_STORE_COOKIES.modelKey,
              model.settingStoreCookies,
            )}
            onChange={(settingStoreCookies) =>
              patchCookieSettings(model, {
                settingStoreCookies,
              })
            }
          />
        </SettingsSection>
      )}
    </SettingsList>
  );
}

export function countOverriddenSettings(model: ModelWithSettings) {
  const settings: (BooleanSetting | IntegerSetting)[] = [];

  if (modelSupportsCookieSettings(model)) {
    settings.push(model.settingSendCookies, model.settingStoreCookies);
  }

  settings.push(model.settingValidateCertificates);

  if (modelSupportsHttpSettings(model)) {
    settings.push(model.settingFollowRedirects, model.settingRequestTimeout);
  }

  if (modelSupportsMessageSizeSettings(model)) {
    settings.push(model.settingRequestMessageSize);
  }

  return settings.filter(
    (setting) => isInheritedSetting(setting) && setting.enabled === true,
  ).length;
}

function patchCookieSettings(
  model: ModelWithCookieSettings,
  patch: Partial<CookieSettingsPatch>,
) {
  switch (model.model) {
    case "workspace":
      return patchModel(model, patch as Partial<Workspace>);
    case "folder":
      return patchModel(model, patch as Partial<Folder>);
    case "http_request":
      return patchModel(model, patch as Partial<HttpRequest>);
    case "websocket_request":
      return patchModel(model, patch as Partial<WebsocketRequest>);
  }
}

function patchHttpSettings(
  model: ModelWithHttpSettings,
  patch: Partial<HttpSettingsPatch>,
) {
  switch (model.model) {
    case "workspace":
      return patchModel(model, patch as Partial<Workspace>);
    case "folder":
      return patchModel(model, patch as Partial<Folder>);
    case "http_request":
      return patchModel(model, patch as Partial<HttpRequest>);
  }
}

function patchTlsSettings(
  model: ModelWithTlsSettings,
  patch: Partial<TlsSettingsPatch>,
) {
  switch (model.model) {
    case "workspace":
      return patchModel(model, patch as Partial<Workspace>);
    case "folder":
      return patchModel(model, patch as Partial<Folder>);
    case "http_request":
      return patchModel(model, patch as Partial<HttpRequest>);
    case "websocket_request":
      return patchModel(model, patch as Partial<WebsocketRequest>);
    case "grpc_request":
      return patchModel(model, patch as Partial<GrpcRequest>);
  }
}

function patchMessageSizeSettings(
  model: ModelWithMessageSizeSettings,
  patch: Partial<MessageSizeSettingsPatch>,
) {
  switch (model.model) {
    case "workspace":
      return patchModel(model, patch as Partial<Workspace>);
    case "folder":
      return patchModel(model, patch as Partial<Folder>);
    case "websocket_request":
      return patchModel(model, patch as Partial<WebsocketRequest>);
    case "grpc_request":
      return patchModel(model, patch as Partial<GrpcRequest>);
  }
}

function modelSupportsHttpSettings(
  model: ModelWithSettings,
): model is ModelWithHttpSettings {
  return modelSupportsSetting(model, SETTING_REQUEST_TIMEOUT);
}

function modelSupportsCookieSettings(
  model: ModelWithSettings,
): model is ModelWithCookieSettings {
  return modelSupportsSetting(model, SETTING_SEND_COOKIES);
}

function modelSupportsTlsSettings(
  model: ModelWithSettings,
): model is ModelWithTlsSettings {
  return modelSupportsSetting(model, SETTING_VALIDATE_CERTIFICATES);
}

function modelSupportsMessageSizeSettings(
  model: ModelWithSettings,
): model is ModelWithMessageSizeSettings {
  return modelSupportsSetting(model, SETTING_REQUEST_MESSAGE_SIZE);
}

function BooleanSettingRow({
  inheritedValue,
  setting,
  settingDefinition,
  onChange,
}: {
  inheritedValue: boolean;
  setting: BooleanSetting;
  settingDefinition: RequestSettingDefinition;
  onChange: (setting: BooleanSetting) => void;
}) {
  const inherited = isInheritedSetting(setting);
  const overridden = inherited ? setting.enabled === true : false;
  const value = inherited
    ? overridden
      ? setting.value
      : inheritedValue
    : setting;

  if (!inherited) {
    return (
      <SettingRowBoolean
        checked={value}
        title={settingDefinition.title}
        description={settingDefinition.description}
        onChange={(value) => onChange(value)}
      />
    );
  }

  return (
    <SettingOverrideRow
      title={settingDefinition.title}
      description={settingDefinition.description}
      overridden={overridden}
      onResetOverride={() => onChange({ ...setting, enabled: false })}
    >
      <Checkbox
        hideLabel
        size="md"
        title={settingDefinition.title}
        checked={value}
        onChange={(value) => onChange({ ...setting, enabled: true, value })}
      />
    </SettingOverrideRow>
  );
}

function IntegerSettingRow({
  inheritedValue,
  setting,
  settingDefinition,
  onChange,
}: {
  inheritedValue: number;
  setting: IntegerSetting;
  settingDefinition: RequestSettingDefinition<"settingRequestTimeout">;
  onChange: (setting: IntegerSetting) => void;
}) {
  const inherited = isInheritedSetting(setting);
  const overridden = inherited ? setting.enabled === true : false;
  const value = inherited
    ? overridden
      ? setting.value
      : inheritedValue
    : setting;

  if (!inherited) {
    return (
      <SettingRow
        title={settingDefinition.title}
        description={settingDefinition.description}
      >
        <NumberUnitInput
          name={settingDefinition.modelKey}
          label={settingDefinition.title}
          unit="ms"
          value={`${value}`}
          placeholder={`${settingDefinition.defaultValue}`}
          validate={isValidInteger}
          onChange={(value) => onChange(parseInteger(value))}
        />
      </SettingRow>
    );
  }

  return (
    <SettingOverrideRow
      title={settingDefinition.title}
      description={settingDefinition.description}
      overridden={overridden}
      onResetOverride={() => onChange({ ...setting, enabled: false })}
    >
      <NumberUnitInput
        name={settingDefinition.modelKey}
        label={settingDefinition.title}
        unit="ms"
        value={`${value}`}
        placeholder={`${settingDefinition.defaultValue}`}
        validate={isValidInteger}
        onChange={(value) =>
          onChange({
            ...setting,
            enabled: true,
            value: parseInteger(value),
          })
        }
      />
    </SettingOverrideRow>
  );
}

function MessageSizeSettingRow({
  inheritedValue,
  setting,
  settingDefinition,
  onChange,
}: {
  inheritedValue: number;
  setting: IntegerSetting;
  settingDefinition: RequestSettingDefinition<"settingRequestMessageSize">;
  onChange: (setting: IntegerSetting) => void;
}) {
  const inherited = isInheritedSetting(setting);
  const overridden = inherited ? setting.enabled === true : false;
  const value = inherited
    ? overridden
      ? setting.value
      : inheritedValue
    : setting;
  const displayValue = formatMegabytes(value);
  const placeholder = "0";

  if (!inherited) {
    return (
      <SettingRow
        title={settingDefinition.title}
        description={settingDefinition.description}
      >
        <MessageSizeInput
          name={settingDefinition.modelKey}
          label={settingDefinition.title}
          value={displayValue}
          placeholder={placeholder}
          onChange={(value) => onChange(parseMegabytes(value))}
        />
      </SettingRow>
    );
  }

  return (
    <SettingOverrideRow
      title={settingDefinition.title}
      description={settingDefinition.description}
      overridden={overridden}
      onResetOverride={() => onChange({ ...setting, enabled: false })}
    >
      <MessageSizeInput
        name={settingDefinition.modelKey}
        label={settingDefinition.title}
        value={displayValue}
        placeholder={placeholder}
        onChange={(value) =>
          onChange({
            ...setting,
            enabled: true,
            value: parseMegabytes(value),
          })
        }
      />
    </SettingOverrideRow>
  );
}

function MessageSizeInput({
  label,
  name,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  name: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <NumberUnitInput
      name={name}
      label={label}
      unit="MB"
      value={value}
      inputMode="decimal"
      step="any"
      placeholder={placeholder}
      validate={isValidMegabytes}
      onChange={onChange}
    />
  );
}

function NumberUnitInput({
  inputMode,
  label,
  name,
  onChange,
  placeholder,
  step,
  unit,
  validate,
  value,
}: {
  inputMode?: "decimal" | "numeric";
  label: string;
  name: string;
  onChange: (value: string) => void;
  placeholder: string;
  step?: number | "any";
  unit: string;
  validate: (value: string) => boolean;
  value: string;
}) {
  return (
    <PlainInput
      hideLabel
      name={name}
      label={label}
      size="sm"
      type="number"
      inputMode={inputMode}
      step={step}
      placeholder={placeholder}
      defaultValue={value}
      className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      containerClassName="!w-48"
      validate={validate}
      rightSlot={
        <span className="flex self-stretch items-center border-l border-border-subtle px-2 text-xs font-medium text-text-subtle">
          {unit}
        </span>
      }
      onChange={onChange}
    />
  );
}

function isInheritedSetting<T>(
  setting: T | { enabled?: boolean; value: T },
): setting is { enabled?: boolean; value: T } {
  return typeof setting === "object" && setting != null && "value" in setting;
}

function resolveInheritedValue(
  ancestors: (Folder | Workspace)[],
  key: "settingRequestTimeout" | "settingRequestMessageSize",
  fallback: IntegerSetting,
): number;
function resolveInheritedValue(
  ancestors: (Folder | Workspace)[],
  key: BooleanWorkspaceSettingKey,
  fallback: BooleanSetting,
): boolean;
function resolveInheritedValue(
  ancestors: (Folder | Workspace)[],
  key: keyof WorkspaceSettings,
  fallback: BooleanSetting | IntegerSetting,
) {
  for (const ancestor of ancestors) {
    const setting = ancestor[key] as BooleanSetting | IntegerSetting;
    if (isInheritedSetting(setting)) {
      if (setting.enabled === true) {
        return setting.value;
      }
      continue;
    }
    return setting;
  }

  return isInheritedSetting(fallback) ? fallback.value : fallback;
}

type WorkspaceSettings = Pick<
  Workspace,
  | "settingFollowRedirects"
  | "settingRequestMessageSize"
  | "settingRequestTimeout"
  | "settingSendCookies"
  | "settingStoreCookies"
  | "settingValidateCertificates"
>;

type BooleanWorkspaceSettingKey = Exclude<
  keyof WorkspaceSettings,
  "settingRequestTimeout" | "settingRequestMessageSize"
>;

function formatMegabytes(bytes: number) {
  const megabytes = bytes / BYTES_PER_MB;
  return Number.isInteger(megabytes)
    ? `${megabytes}`
    : megabytes.toFixed(3).replace(/\.?0+$/, "");
}

function parseMegabytes(value: string) {
  const megabytes = Number(value);
  return Number.isFinite(megabytes) ? Math.round(megabytes * BYTES_PER_MB) : 0;
}

function parseInteger(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function isValidInteger(value: string) {
  const parsed = Number(value);
  return value === "" || (Number.isInteger(parsed) && parsed >= 0);
}

function isValidMegabytes(value: string) {
  if (value === "") return true;
  const megabytes = Number(value);
  return (
    Number.isFinite(megabytes) &&
    megabytes >= 0 &&
    megabytes <= MAX_MESSAGE_SIZE_MB
  );
}
