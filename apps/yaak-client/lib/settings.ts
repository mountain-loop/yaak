import type { Settings } from "@yaakapp-internal/models";
import { rpc } from "./rpc";

export function getSettings(): Promise<Settings> {
  return rpc<Settings>("models_get_settings");
}
