import { type UseMutationOptions, useMutation } from "@tanstack/react-query";
import type { RpcSchema } from "@yaakapp-internal/proxy-lib";
import { minPromiseMillis } from "@yaakapp-internal/ui";
import type { Req, Res } from "../lib/rpc";
import { rpc } from "../lib/rpc";

/**
 * React Query mutation wrapper for RPC commands.
 */
export function useRpcMutation<K extends keyof RpcSchema>(
  cmd: K,
  opts?: Omit<UseMutationOptions<Res<K>, Error, Req<K>>, "mutationFn">,
) {
  return useMutation<Res<K>, Error, Req<K>>({
    mutationFn: (payload) => minPromiseMillis(rpc(cmd, payload)),
    ...opts,
  });
}
