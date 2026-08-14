import { rpc } from "../lib/rpc";
import { useFastMutation } from "./useFastMutation";

export function useDeleteGrpcConnections(requestId?: string) {
  return useFastMutation({
    mutationKey: ["delete_grpc_connections", requestId],
    mutationFn: async () => {
      if (requestId === undefined) return;
      await rpc("cmd_delete_all_grpc_connections", { requestId });
    },
  });
}
