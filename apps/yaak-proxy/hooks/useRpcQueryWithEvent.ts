import { type UseQueryOptions, useQueryClient } from "@tanstack/react-query";
import type { RpcEventSchema, RpcSchema } from "@yaakapp-internal/proxy-lib";
import type { Req, Res } from "../lib/rpc";
import { useRpcEvent } from "./useRpcEvent";
import { useRpcQuery } from "./useRpcQuery";

/**
 * Combines useRpcQuery with an event listener that invalidates the query
 * whenever the specified event fires, keeping data fresh automatically.
 */
export function useRpcQueryWithEvent<
  K extends keyof RpcSchema,
  E extends keyof RpcEventSchema & string,
>(cmd: K, payload: Req<K>, event: E, opts?: Omit<UseQueryOptions<Res<K>>, "queryKey" | "queryFn">) {
  const queryClient = useQueryClient();
  const query = useRpcQuery(cmd, payload, opts);

  useRpcEvent(event, () => {
    void queryClient.invalidateQueries({ queryKey: [cmd, payload] });
  });

  return query;
}
