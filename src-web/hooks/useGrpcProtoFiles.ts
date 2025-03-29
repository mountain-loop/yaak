import { useKeyValue } from './useKeyValue';

export function protoFilesArgs(requestId: string | null) {
  return {
    namespace: 'global' as const,
    key: ['proto_files', requestId ?? 'n/a'],
  };
}

export function useGrpcProtoFiles(activeRequestId: string | null) {
  return useKeyValue<string[]>({ ...protoFilesArgs(activeRequestId), fallback: [] });
}
