import { invoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import type {
  RpcEventSchema,
  RpcSchema,
} from "../../crates-proxy/yaak-proxy-lib/bindings/gen_rpc";

type Req<K extends keyof RpcSchema> = RpcSchema[K][0];
type Res<K extends keyof RpcSchema> = RpcSchema[K][1];

export async function rpc<K extends keyof RpcSchema>(
  cmd: K,
  payload: Req<K>,
): Promise<Res<K>> {
  return invoke("rpc", { cmd, payload }) as Promise<Res<K>>;
}

/** Subscribe to a backend event. Returns an unsubscribe function. */
export function listen<K extends keyof RpcEventSchema>(
  event: K & string,
  callback: (payload: RpcEventSchema[K]) => void,
): () => void {
  let unsub: (() => void) | null = null;
  tauriListen<RpcEventSchema[K]>(event, (e) => callback(e.payload))
    .then((fn) => {
      unsub = fn;
    })
    .catch(console.error);
  return () => unsub?.();
}
