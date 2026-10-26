import type { RpcEventSchema, RpcSchema } from "@yaakapp-internal/proxy-lib";
import { command, subscribe } from "./tauri";

export type Req<K extends keyof RpcSchema> = RpcSchema[K][0];
export type Res<K extends keyof RpcSchema> = RpcSchema[K][1];

/** Call a backend command. A failure rejects with an `Error`, never the bare string Tauri gives. */
export async function rpc<K extends keyof RpcSchema>(cmd: K, payload: Req<K>): Promise<Res<K>> {
  try {
    return await command<Res<K>>("rpc", { cmd, payload });
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/** Subscribe to a backend event. Returns an unsubscribe function. */
export function listen<K extends keyof RpcEventSchema>(
  event: K & string,
  callback: (payload: RpcEventSchema[K]) => void,
): () => void {
  return subscribe<RpcEventSchema[K]>(event, callback);
}
