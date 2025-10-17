import { useQuery } from '@tanstack/react-query';
import type { GrpcRequest } from '@yaakapp-internal/models';
import type {
  CallGrpcRequestActionRequest,
  GetGrpcRequestActionsResponse,
  GrpcRequestAction,
} from '@yaakapp-internal/plugins';
import { useMemo } from 'react';
import { invokeCmd } from '../lib/tauri';
import { getGrpcProtoFiles } from './useGrpcProtoFiles';
import { usePluginsKey } from './usePlugins';

export type CallableGrpcRequestAction = Pick<GrpcRequestAction, 'label' | 'icon'> & {
  call: (grpcRequest: GrpcRequest) => Promise<void>;
};

export function useGrpcRequestActions() {
  const pluginsKey = usePluginsKey();

  const actionsResult = useQuery<CallableGrpcRequestAction[]>({
    queryKey: ['grpc_request_actions', pluginsKey],
    queryFn: async () => {
      return getGrpcRequestActions();
    },
  });

  const actions = useMemo(() => {
    return actionsResult.data ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(actionsResult.data)]);

  return actions;
}

export async function getGrpcRequestActions() {
  const responses = await invokeCmd<GetGrpcRequestActionsResponse[]>('cmd_grpc_request_actions');

  return responses.flatMap((r) =>
    r.actions.map((a, i) => ({
      label: a.label,
      icon: a.icon,
      call: async (grpcRequest: GrpcRequest) => {
        const protoFiles = await getGrpcProtoFiles(grpcRequest.id);
        const payload: CallGrpcRequestActionRequest = {
          index: i,
          pluginRefId: r.pluginRefId,
          args: { grpcRequest, protoFiles },
        };
        await invokeCmd('cmd_call_grpc_request_action', { req: payload });
      },
    })),
  );
}
