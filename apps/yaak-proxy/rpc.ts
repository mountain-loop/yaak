import { invoke } from "@tauri-apps/api/core";
import type { RpcSchema } from "../../crates-proxy/yaak-proxy-lib/bindings/gen_rpc";

type Req<K extends keyof RpcSchema> = RpcSchema[K][0];
type Res<K extends keyof RpcSchema> = RpcSchema[K][1];

export async function rpc<K extends keyof RpcSchema>(
  cmd: K,
  payload: Req<K>,
): Promise<Res<K>> {
  return invoke("rpc", { cmd, payload }) as Promise<Res<K>>;
}
