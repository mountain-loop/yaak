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
  SETTING_REQUEST_TIMEOUT,
  SETTING_SEND_COOKIES,
  SETTING_STORE_COOKIES,
  SETTING_VALIDATE_CERTIFICATES,
} from "../lib/requestSettings";
import { Checkbox } from "./core/Checkbox";
import { PlainInput } from "./core/PlainInput";
import {
  SettingOverrideRow,
  SettingRowBoolean,
  SettingRowNumber,
  SettingsList,
  SettingsSection,
} from "./core/SettingRow";

interface Props {
  showSectionTitles?: boolean;
  model: ModelWithSettings;
}

type ModelWithSettings = Workspace | Folder | HttpRequest | WebsocketRequest | GrpcRequest;
type ModelWithHttpSettings = Workspace | Folder | HttpRequest;
type ModelWithTlsSettings = Workspace | Folder | HttpRequest | WebsocketRequest | GrpcRequest;
type ModelWithCookieSettings = Workspace | Folder | HttpRequest | WebsocketRequest;
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

export function ModelSettingsEditor({ model, showSectionTitles = false }: Props) {
  const ancestors = useModelAncestors(model);
  const supportsHttpSettings = modelSupportsHttpSettings(model);
  const supportsCookieSettings = modelSupportsCookieSettings(model);
  const supportsTlsSettings = modelSupportsTlsSettings(model);

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
        <SettingsSection title={supportsTlsSettings || showSectionTitles ? "Cookies" : null}>
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

  return settings.filter((setting) => isInheritedSetting(setting) && setting.enabled === true)
    .length;
}

function patchCookieSettings(model: ModelWithCookieSettings, patch: Partial<CookieSettingsPatch>) {
  if (model.model === "workspace") return patchModel(model, patch as Partial<Workspace>);
  if (model.model === "folder") return patchModel(model, patch as Partial<Folder>);
  if (model.model === "http_request") return patchModel(model, patch as Partial<HttpRequest>);
  if (model.model === "websocket_request")
    return patchModel(model, patch as Partial<WebsocketRequest>);
  throw new Error("Unsupported cookie settings model");
}

function patchHttpSettings(model: ModelWithHttpSettings, patch: Partial<HttpSettingsPatch>) {
  if (model.model === "workspace") return patchModel(model, patch as Partial<Workspace>);
  if (model.model === "folder") return patchModel(model, patch as Partial<Folder>);
  return patchModel(model, patch as Partial<HttpRequest>);
}

function patchTlsSettings(model: ModelWithTlsSettings, patch: Partial<TlsSettingsPatch>) {
  if (model.model === "workspace") return patchModel(model, patch as Partial<Workspace>);
  if (model.model === "folder") return patchModel(model, patch as Partial<Folder>);
  if (model.model === "http_request") return patchModel(model, patch as Partial<HttpRequest>);
  if (model.model === "websocket_request")
    return patchModel(model, patch as Partial<WebsocketRequest>);
  return patchModel(model, patch as Partial<GrpcRequest>);
}

function modelSupportsHttpSettings(model: ModelWithSettings): model is ModelWithHttpSettings {
  return modelSupportsSetting(model, SETTING_REQUEST_TIMEOUT);
}

function modelSupportsCookieSettings(model: ModelWithSettings): model is ModelWithCookieSettings {
  return modelSupportsSetting(model, SETTING_SEND_COOKIES);
}

function modelSupportsTlsSettings(model: ModelWithSettings): model is ModelWithTlsSettings {
  return modelSupportsSetting(model, SETTING_VALIDATE_CERTIFICATES);
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
  const value = inherited ? (overridden ? setting.value : inheritedValue) : setting;

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
  const value = inherited ? (overridden ? setting.value : inheritedValue) : setting;

  if (!inherited) {
    return (
      <SettingRowNumber
        name={settingDefinition.modelKey}
        title={settingDefinition.title}
        description={settingDefinition.description}
        value={value}
        placeholder={`${settingDefinition.defaultValue}`}
        validate={(value) => value === "" || Number.parseInt(value, 10) >= 0}
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
      <PlainInput
        hideLabel
        name={settingDefinition.modelKey}
        label={settingDefinition.title}
        size="sm"
        type="number"
        placeholder={`${settingDefinition.defaultValue}`}
        defaultValue={`${value}`}
        containerClassName="!w-48"
        validate={(value) => value === "" || Number.parseInt(value, 10) >= 0}
        onChange={(value) =>
          onChange({
            ...setting,
            enabled: true,
            value: Number.parseInt(value, 10) || 0,
          })
        }
      />
    </SettingOverrideRow>
  );
}

function isInheritedSetting<T>(
  setting: T | { enabled?: boolean; value: T },
): setting is { enabled?: boolean; value: T } {
  return typeof setting === "object" && setting != null && "value" in setting;
}

function resolveInheritedValue(
  ancestors: (Folder | Workspace)[],
  key: "settingRequestTimeout",
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
  | "settingRequestTimeout"
  | "settingSendCookies"
  | "settingStoreCookies"
  | "settingValidateCertificates"
>;

type BooleanWorkspaceSettingKey = Exclude<keyof WorkspaceSettings, "settingRequestTimeout">;
