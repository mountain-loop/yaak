import classNames from 'classnames';
import type { CSSProperties } from 'react';
import React, { useEffect, useMemo } from 'react';
import { useActiveRequest } from '../hooks/useActiveRequest';
import { useGrpc } from '../hooks/useGrpc';
import { useGrpcConnections } from '../hooks/useGrpcConnections';
import { useGrpcEvents } from '../hooks/useGrpcEvents';
import { useGrpcProtoFiles } from '../hooks/useGrpcProtoFiles';
import { useUpdateAnyGrpcRequest } from '../hooks/useUpdateAnyGrpcRequest';
import { Banner } from './core/Banner';
import { HotKeyList } from './core/HotKeyList';
import { SplitLayout } from './core/SplitLayout';
import { GrpcConnectionMessagesPane } from './GrpcConnectionMessagesPane';
import { GrpcConnectionSetupPane } from './GrpcConnectionSetupPane';

interface Props {
  style: CSSProperties;
}

const emptyArray: string[] = [];

export function GrpcConnectionLayout({ style }: Props) {
  const activeRequest = useActiveRequest('grpc_request');
  const updateRequest = useUpdateAnyGrpcRequest();
  const connections = useGrpcConnections().filter((c) => c.requestId === activeRequest?.id);
  const activeConnection = connections[0] ?? null;
  const messages = useGrpcEvents(activeConnection?.id ?? null);
  const protoFilesKv = useGrpcProtoFiles(activeRequest?.id ?? null);
  const protoFiles = protoFilesKv.value ?? emptyArray;
  const grpc = useGrpc(activeRequest, activeConnection, protoFiles);

  const services = grpc.reflect.data ?? null;
  useEffect(() => {
    if (services == null || activeRequest == null) return;
    const s = services.find((s) => s.name === activeRequest.service);
    if (s == null) {
      updateRequest.mutate({
        id: activeRequest.id,
        update: {
          service: services[0]?.name ?? null,
          method: services[0]?.methods[0]?.name ?? null,
        },
      });
      return;
    }

    const m = s.methods.find((m) => m.name === activeRequest.method);
    if (m == null) {
      updateRequest.mutate({
        id: activeRequest.id,
        update: { method: s.methods[0]?.name ?? null },
      });
      return;
    }
  }, [activeRequest, services, updateRequest]);

  const activeMethod = useMemo(() => {
    if (services == null || activeRequest == null) return null;

    const s = services.find((s) => s.name === activeRequest.service);
    if (s == null) return null;
    return s.methods.find((m) => m.name === activeRequest.method);
  }, [activeRequest, services]);

  const methodType:
    | 'unary'
    | 'server_streaming'
    | 'client_streaming'
    | 'streaming'
    | 'no-schema'
    | 'no-method' = useMemo(() => {
    if (services == null) return 'no-schema';
    if (activeMethod == null) return 'no-method';
    if (activeMethod.clientStreaming && activeMethod.serverStreaming) return 'streaming';
    if (activeMethod.clientStreaming) return 'client_streaming';
    if (activeMethod.serverStreaming) return 'server_streaming';
    return 'unary';
  }, [activeMethod, services]);

  if (activeRequest == null) {
    return null;
  }

  return (
    <SplitLayout
      name="grpc_layout"
      className="p-3 gap-1.5"
      style={style}
      firstSlot={({ style }) => (
        <GrpcConnectionSetupPane
          style={style}
          activeRequest={activeRequest}
          protoFiles={protoFiles}
          methodType={methodType}
          isStreaming={grpc.isStreaming}
          onGo={grpc.go.mutate}
          onCommit={grpc.commit.mutate}
          onCancel={grpc.cancel.mutate}
          onSend={grpc.send.mutate}
          services={services ?? null}
          reflectionError={grpc.reflect.error as string | undefined}
          reflectionLoading={grpc.reflect.isFetching}
        />
      )}
      secondSlot={({ style }) =>
        !grpc.go.isPending && (
          <div
            style={style}
            className={classNames(
              'x-theme-responsePane',
              'max-h-full h-full grid grid-rows-[minmax(0,1fr)] grid-cols-1',
              'bg-surface rounded-md border border-border-subtle',
              'shadow relative',
            )}
          >
            {grpc.go.error ? (
              <Banner color="danger" className="m-2">
                {grpc.go.error}
              </Banner>
            ) : messages.length >= 0 ? (
              <GrpcConnectionMessagesPane activeRequest={activeRequest} methodType={methodType} />
            ) : (
              <HotKeyList hotkeys={['grpc_request.send', 'sidebar.focus', 'url_bar.focus']} />
            )}
          </div>
        )
      }
    />
  );
}
