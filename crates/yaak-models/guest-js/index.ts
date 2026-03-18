import { AnyModel } from "../bindings/gen_models";

export * from "../bindings/gen_models";
export * from "../bindings/gen_util";
export * from "./store";
export * from "./atoms";

const MODEL_LABELS_RU: Record<string, string> = {
  workspace: "Рабочее пространство",
  folder: "Папка",
  http_request: "HTTP-запрос",
  grpc_request: "gRPC-запрос",
  websocket_request: "WebSocket-запрос",
  environment: "Окружение",
  cookie_jar: "Хранилище cookie",
  plugin: "Плагин",
  grpc_connection: "gRPC-соединение",
  http_response: "HTTP-ответ",
  settings: "Настройки",
  user: "Пользователь",
  key_value: "Ключ-значение",
  certificate: "Сертификат",
};

export function modelTypeLabel(m: AnyModel): string {
  return MODEL_LABELS_RU[m.model] ?? m.model;
}
