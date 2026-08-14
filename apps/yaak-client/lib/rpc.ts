import type { RpcPayload } from "@yaakapp-internal/platform";
import { platform } from "@yaakapp-internal/platform";
import type { RpcSchema } from "@yaakapp-internal/tauri-client";

/**
 * Every backend command the app can call: the generated wire schema (one field
 * per `RpcRouter` registration on the Rust side), plus host plugin commands
 * that ride outside the envelope. A typo'd or unregistered command name is a
 * compile error.
 *
 * `RpcSchema` also carries each command's request and response payload types;
 * adopting them at call sites is an incremental follow-up.
 */
type AppCmd = keyof RpcSchema | "plugin:yaak-license|check";

/** Call a backend command. */
export function rpc<T>(cmd: AppCmd, payload?: RpcPayload): Promise<T> {
  return platform.rpc<T>(cmd, payload);
}
