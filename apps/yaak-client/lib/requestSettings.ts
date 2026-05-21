import type { AnyModel, Workspace } from "@yaakapp-internal/models";

type ModelType = AnyModel["model"];

type WorkspaceRequestSettings = Pick<
  Workspace,
  | "settingFollowRedirects"
  | "settingRequestTimeout"
  | "settingSendCookies"
  | "settingStoreCookies"
  | "settingValidateCertificates"
>;

type ModelForType<T extends ModelType> = Extract<AnyModel, { model: T }>;

type ModelTypeWithSetting<K extends RequestSettingKey> = {
  [M in ModelType]: K extends keyof ModelForType<M> ? M : never;
}[ModelType];

export type RequestSettingDefinition<K extends RequestSettingKey = RequestSettingKey> = {
  defaultValue: WorkspaceRequestSettings[K];
  description: string;
  modelKey: K;
  models: readonly ModelTypeWithSetting<K>[];
  title: string;
};

export type RequestSettingKey = keyof WorkspaceRequestSettings;

function defineRequestSetting<const K extends RequestSettingKey>(
  setting: RequestSettingDefinition<K>,
) {
  return setting;
}

export const SETTING_REQUEST_TIMEOUT = defineRequestSetting({
  defaultValue: 0,
  description: "Maximum request duration in milliseconds. Set to 0 to disable.",
  modelKey: "settingRequestTimeout",
  models: ["workspace", "folder", "http_request"],
  title: "Request Timeout",
});

export const SETTING_VALIDATE_CERTIFICATES = defineRequestSetting({
  defaultValue: true,
  description: "When disabled, skip validation of server certificates.",
  modelKey: "settingValidateCertificates",
  models: ["workspace", "folder", "http_request", "websocket_request", "grpc_request"],
  title: "Validate TLS certificates",
});

export const SETTING_FOLLOW_REDIRECTS = defineRequestSetting({
  defaultValue: true,
  description: "Follow HTTP redirects automatically.",
  modelKey: "settingFollowRedirects",
  models: ["workspace", "folder", "http_request"],
  title: "Follow redirects",
});

export const SETTING_SEND_COOKIES = defineRequestSetting({
  defaultValue: true,
  description: "Attach matching cookies from the active cookie jar to outgoing requests.",
  modelKey: "settingSendCookies",
  models: ["workspace", "folder", "http_request", "websocket_request"],
  title: "Automatically send cookies",
});

export const SETTING_STORE_COOKIES = defineRequestSetting({
  defaultValue: true,
  description: "Save cookies from Set-Cookie response headers to the active cookie jar.",
  modelKey: "settingStoreCookies",
  models: ["workspace", "folder", "http_request", "websocket_request"],
  title: "Automatically store cookies",
});

export function modelSupportsSetting<K extends RequestSettingKey>(
  model: Pick<AnyModel, "model">,
  setting: RequestSettingDefinition<K>,
) {
  return setting.models.some((modelType) => modelType === model.model);
}
