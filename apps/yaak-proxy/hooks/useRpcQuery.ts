import { type UseQueryOptions, useQuery } from "@tanstack/react-query";
import type { RpcSchema } from "@yaakapp-internal/proxy-lib";
import type { Req, Res } from "../lib/rpc";
import { rpc } from "../lib/rpc";

/**
 * React Query wrapper for RPC commands.
 * Automatically caches by [cmd, payload] and supports all useQuery options.
 */
export function useRpcQuery<K extends keyof RpcSchema>(
  cmd: K,
  payload: Req<K>,
  opts?: Omit<UseQueryOptions<Res<K>>, "queryKey" | "queryFn">,
) {
  return useQuery<Res<K>>({
    queryKey: [cmd, payload],
    queryFn: () => rpc(cmd, payload),
    ...opts,
  });
}
