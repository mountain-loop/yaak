import { useMutation, useQuery } from '@tanstack/react-query';
import { emit } from '@tauri-apps/api/event';
import type { GrpcConnection, GrpcRequest } from '@yaakapp-internal/models';
import {jotaiStore} from "../lib/jotai";
import { minPromiseMillis } from '../lib/minPromiseMillis';
import { invokeCmd } from '../lib/tauri';
import {activeEnvironmentIdAtom, useActiveEnvironment} from './useActiveEnvironment';
import { useDebouncedValue } from './useDebouncedValue';

export interface ReflectResponseService {
  name: string;
  methods: { name: string; schema: string; serverStreaming: boolean; clientStreaming: boolean }[];
}

export function useGrpc(
  req: GrpcRequest | null,
  conn: GrpcConnection | null,
  protoFiles: string[],
) {
  const requestId = req?.id ?? 'n/a';
  const environment = useActiveEnvironment();

  const go = useMutation<void, string>({
    mutationKey: ['grpc_go', conn?.id],
    mutationFn: () =>
      invokeCmd<void>('cmd_grpc_go', { requestId, environmentId: environment?.id, protoFiles }),
  });

  const send = useMutation({
    mutationKey: ['grpc_send', conn?.id],
    mutationFn: ({ message }: { message: string }) =>
      emit(`grpc_client_msg_${conn?.id ?? 'none'}`, { Message: message }),
  });

  const cancel = useMutation({
    mutationKey: ['grpc_cancel', conn?.id ?? 'n/a'],
    mutationFn: () => emit(`grpc_client_msg_${conn?.id ?? 'none'}`, 'Cancel'),
  });

  const commit = useMutation({
    mutationKey: ['grpc_commit', conn?.id ?? 'n/a'],
    mutationFn: () => emit(`grpc_client_msg_${conn?.id ?? 'none'}`, 'Commit'),
  });

  const debouncedUrl = useDebouncedValue<string>(req?.url ?? '', 1000);

  const reflect = useQuery<ReflectResponseService[], string>({
    enabled: req != null,
    queryKey: ['grpc_reflect', req?.id ?? 'n/a', debouncedUrl, protoFiles],
    queryFn: () => {
      const environmentId = jotaiStore.get(activeEnvironmentIdAtom);
      return minPromiseMillis<ReflectResponseService[]>(
        invokeCmd('cmd_grpc_reflect', { requestId, protoFiles, environmentId }),
        300,
      );
    },
  });

  return {
    go,
    reflect,
    cancel,
    commit,
    isStreaming: conn != null && conn.state !== 'closed',
    send,
  };
}
