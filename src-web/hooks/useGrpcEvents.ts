import { useQuery } from '@tanstack/react-query';
import type { GrpcEvent } from '@yaakapp-internal/models';
import { invokeCmd } from '../lib/tauri';

export function grpcEventsQueryKey({ connectionId }: { connectionId: string }) {
  return ['grpc_events', { connectionId }];
}

export function useGrpcEvents(connectionId: string | null) {
  return (
    useQuery<GrpcEvent[]>({
      enabled: connectionId !== null,
      initialData: [],
      queryKey: grpcEventsQueryKey({ connectionId: connectionId ?? 'n/a' }),
      queryFn: async () => {
        return (await invokeCmd('cmd_list_grpc_events', {
          connectionId,
          limit: 200,
        })) as GrpcEvent[];
      },
    }).data ?? []
  );
}
