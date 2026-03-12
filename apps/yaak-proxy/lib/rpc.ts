import type { RpcEventSchema, RpcSchema } from '@yaakapp-internal/proxy-lib';
import { command, subscribe } from './tauri';

export type Req<K extends keyof RpcSchema> = RpcSchema[K][0];
export type Res<K extends keyof RpcSchema> = RpcSchema[K][1];

export async function rpc<K extends keyof RpcSchema>(cmd: K, payload: Req<K>): Promise<Res<K>> {
  return command<Res<K>>('rpc', { cmd, payload });
}

/** Subscribe to a backend event. Returns an unsubscribe function. */
export function listen<K extends keyof RpcEventSchema>(
  event: K & string,
  callback: (payload: RpcEventSchema[K]) => void,
): () => void {
  return subscribe<RpcEventSchema[K]>(event, callback);
}
