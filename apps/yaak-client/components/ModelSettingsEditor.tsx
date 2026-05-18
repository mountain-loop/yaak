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
type ModelWithCookieSettings = Workspace | Folder | HttpRequest | WebsocketRequest | GrpcRequest;
type BooleanSetting = boolean | InheritedBoolSetting;
type IntegerSetting = number | InheritedIntSetting;
type CookieSettingsPatch = {
  settingSendCookies?: ModelWithCookieSettings["settingSendCookies"];
  settingStoreCookies?: ModelWithCookieSettings["settingStoreCookies"];
};
type HttpSettingsPatch = {
  settingValidateCertificates?: ModelWithHttpSettings["settingValidateCertificates"];
  settingFollowRedirects?: ModelWithHttpSettings["settingFollowRedirects"];
  settingRequestTimeout?: ModelWithHttpSettings["settingRequestTimeout"];
};

export function ModelSettingsEditor({ model, showSectionTitles = false }: Props) {
  const ancestors = useModelAncestors(model);
  const supportsHttpSettings =
    model.model === "workspace" || model.model === "folder" || model.model === "http_request";

  return (
    <SettingsList className="space-y-8">
      {supportsHttpSettings && (
        <SettingsSection title={showSectionTitles ? "Requests" : null}>
          <IntegerSettingRow
            title="Request Timeout"
            description="Maximum request duration in milliseconds. Set to 0 to disable the timeout."
            name="settingRequestTimeout"
            setting={model.settingRequestTimeout}
            inheritedValue={resolveInheritedValue(
              ancestors,
              "settingRequestTimeout",
              model.settingRequestTimeout,
            )}
            onChange={(settingRequestTimeout) =>
              patchHttpSettings(model, {
                settingRequestTimeout,
              })
            }
          />
          <BooleanSettingRow
            title="Validate TLS certificates"
            description="When disabled, skip validation of server certificates."
            setting={model.settingValidateCertificates}
            inheritedValue={resolveInheritedValue(
              ancestors,
              "settingValidateCertificates",
              model.settingValidateCertificates,
            )}
            onChange={(settingValidateCertificates) =>
              patchHttpSettings(model, {
                settingValidateCertificates,
              })
            }
          />
          <BooleanSettingRow
            title="Follow redirects"
            description="Follow HTTP redirects automatically."
            setting={model.settingFollowRedirects}
            inheritedValue={resolveInheritedValue(
              ancestors,
              "settingFollowRedirects",
              model.settingFollowRedirects,
            )}
            onChange={(settingFollowRedirects) =>
              patchHttpSettings(model, {
                settingFollowRedirects,
              })
            }
          />
        </SettingsSection>
      )}
      <SettingsSection title={supportsHttpSettings || showSectionTitles ? "Cookies" : null}>
        <BooleanSettingRow
          title="Automatically send cookies"
          description="Attach matching cookies from the active cookie jar to outgoing requests."
          setting={model.settingSendCookies}
          inheritedValue={resolveInheritedValue(
            ancestors,
            "settingSendCookies",
            model.settingSendCookies,
          )}
          onChange={(settingSendCookies) =>
            patchCookieSettings(model, {
              settingSendCookies,
            })
          }
        />
        <BooleanSettingRow
          title="Automatically store cookies"
          description="Save cookies from Set-Cookie response headers to the active cookie jar."
          setting={model.settingStoreCookies}
          inheritedValue={resolveInheritedValue(
            ancestors,
            "settingStoreCookies",
            model.settingStoreCookies,
          )}
          onChange={(settingStoreCookies) =>
            patchCookieSettings(model, {
              settingStoreCookies,
            })
          }
        />
      </SettingsSection>
    </SettingsList>
  );
}

export function countOverriddenSettings(model: ModelWithSettings) {
  const settings: (BooleanSetting | IntegerSetting)[] = [
    model.settingSendCookies,
    model.settingStoreCookies,
  ];

  if (model.model === "workspace" || model.model === "folder" || model.model === "http_request") {
    settings.push(
      model.settingValidateCertificates,
      model.settingFollowRedirects,
      model.settingRequestTimeout,
    );
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
  return patchModel(model, patch as Partial<GrpcRequest>);
}

function patchHttpSettings(model: ModelWithHttpSettings, patch: Partial<HttpSettingsPatch>) {
  if (model.model === "workspace") return patchModel(model, patch as Partial<Workspace>);
  if (model.model === "folder") return patchModel(model, patch as Partial<Folder>);
  return patchModel(model, patch as Partial<HttpRequest>);
}

function BooleanSettingRow({
  description,
  inheritedValue,
  setting,
  title,
  onChange,
}: {
  description: string;
  inheritedValue: boolean;
  setting: BooleanSetting;
  title: string;
  onChange: (setting: BooleanSetting) => void;
}) {
  const inherited = isInheritedSetting(setting);
  const overridden = inherited ? setting.enabled === true : false;
  const value = inherited ? (overridden ? setting.value : inheritedValue) : setting;

  if (!inherited) {
    return (
      <SettingRowBoolean
        checked={value}
        title={title}
        description={description}
        onChange={(value) => onChange(value)}
      />
    );
  }

  return (
    <SettingOverrideRow
      title={title}
      description={description}
      overridden={overridden}
      onResetOverride={() => onChange({ ...setting, enabled: false })}
    >
      <Checkbox
        hideLabel
        size="md"
        title={title}
        checked={value}
        onChange={(value) => onChange({ ...setting, enabled: true, value })}
      />
    </SettingOverrideRow>
  );
}

function IntegerSettingRow({
  description,
  inheritedValue,
  name,
  setting,
  title,
  onChange,
}: {
  description: string;
  inheritedValue: number;
  name: string;
  setting: IntegerSetting;
  title: string;
  onChange: (setting: IntegerSetting) => void;
}) {
  const inherited = isInheritedSetting(setting);
  const overridden = inherited ? setting.enabled === true : false;
  const value = inherited ? (overridden ? setting.value : inheritedValue) : setting;

  if (!inherited) {
    return (
      <SettingRowNumber
        name={name}
        title={title}
        description={description}
        value={value}
        placeholder="0"
        validate={(value) => value === "" || Number.parseInt(value, 10) >= 0}
        onChange={(value) => onChange(value)}
      />
    );
  }

  return (
    <SettingOverrideRow
      title={title}
      description={description}
      overridden={overridden}
      onResetOverride={() => onChange({ ...setting, enabled: false })}
    >
      <PlainInput
        hideLabel
        name={name}
        label={title}
        size="sm"
        type="number"
        placeholder="0"
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
