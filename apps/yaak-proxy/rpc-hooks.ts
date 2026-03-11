import {
  useQuery,
  useQueryClient,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { useEffect } from "react";
import type { RpcEventSchema, RpcSchema } from "@yaakapp-internal/proxy-lib";
import { minPromiseMillis } from "@yaakapp-internal/ui";
import { listen, rpc } from "./rpc";

type Req<K extends keyof RpcSchema> = RpcSchema[K][0];
type Res<K extends keyof RpcSchema> = RpcSchema[K][1];

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

/**
 * Subscribe to an RPC event. Cleans up automatically on unmount.
 */
export function useRpcEvent<K extends keyof RpcEventSchema>(
  event: K & string,
  callback: (payload: RpcEventSchema[K]) => void,
) {
  useEffect(() => {
    return listen(event, callback);
  }, [event, callback]);
}

/**
 * Combines useRpcQuery with an event listener that invalidates the query
 * whenever the specified event fires, keeping data fresh automatically.
 */
export function useRpcQueryWithEvent<
  K extends keyof RpcSchema,
  E extends keyof RpcEventSchema & string,
>(
  cmd: K,
  payload: Req<K>,
  event: E,
  opts?: Omit<UseQueryOptions<Res<K>>, "queryKey" | "queryFn">,
) {
  const queryClient = useQueryClient();
  const query = useRpcQuery(cmd, payload, opts);

  useRpcEvent(event, () => {
    queryClient.invalidateQueries({ queryKey: [cmd, payload] });
  });

  return query;
}
