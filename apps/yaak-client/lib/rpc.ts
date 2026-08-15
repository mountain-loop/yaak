import type { RpcPayload } from "@yaakapp-internal/platform";
import { platform } from "@yaakapp-internal/platform";
import type { RpcSchema } from "@yaakapp-internal/rpc-schema";

/**
 * Every backend command the app can call: the generated wire schema, one field
 * per `RpcRouter` registration on the Rust side. A typo'd or unregistered
 * command name is a compile error. Host plugin commands (license, fonts,
 * mac-window) don't appear here — each lives behind its own package's facade.
 *
 * `RpcSchema` also carries each command's request and response payload types;
 * adopting them at call sites is an incremental follow-up.
 */
type AppCmd = keyof RpcSchema;

/** Call a backend command. */
export function rpc<T>(cmd: AppCmd, payload?: RpcPayload): Promise<T> {
  return platform.rpc<T>(cmd, payload);
}
