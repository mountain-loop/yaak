import { patchModel } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import type { CSSProperties } from 'react';
import React, { useEffect, useMemo } from 'react';
import { useActiveRequest } from '../hooks/useActiveRequest';
import { useGrpc } from '../hooks/useGrpc';
import { useGrpcProtoFiles } from '../hooks/useGrpcProtoFiles';
import { activeGrpcConnectionAtom, useGrpcEvents } from '../hooks/usePinnedGrpcConnection';
import { workspaceLayoutAtom } from '../lib/atoms';
import { Banner } from './core/Banner';
import { HotKeyList } from './core/HotKeyList';
import { SplitLayout } from './core/SplitLayout';
import { GrpcRequestPane } from './GrpcRequestPane';
import { GrpcResponsePane } from './GrpcResponsePane';

interface Props {
  style: CSSProperties;
}

const emptyArray: string[] = [];

export function GrpcConnectionLayout({ style }: Props) {
  const workspaceLayout = useAtomValue(workspaceLayoutAtom);
  const activeRequest = useActiveRequest('grpc_request');
  const activeConnection = useAtomValue(activeGrpcConnectionAtom);
  const grpcEvents = useGrpcEvents(activeConnection?.id ?? null);
  const protoFilesKv = useGrpcProtoFiles(activeRequest?.id ?? null);
  const protoFiles = protoFilesKv.value ?? emptyArray;
  const grpc = useGrpc(activeRequest, activeConnection, protoFiles);

  const services = grpc.reflect.data ?? null;
  useEffect(() => {
    if (services == null || activeRequest == null) return;
    const s = services.find((s) => s.name === activeRequest.service);
    if (s == null) {
      patchModel(activeRequest, {
        service: services[0]?.name ?? null,
        method: services[0]?.methods[0]?.name ?? null,
      }).catch(console.error);
      return;
    }

    const m = s.methods.find((m) => m.name === activeRequest.method);
    if (m == null) {
      patchModel(activeRequest, {
        method: s.methods[0]?.name ?? null,
      }).catch(console.error);
      return;
    }
  }, [activeRequest, services]);

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
      layout={workspaceLayout}
      firstSlot={({ style }) => (
        <GrpcRequestPane
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
            ) : grpcEvents.length >= 0 ? (
              <GrpcResponsePane activeRequest={activeRequest} methodType={methodType} />
            ) : (
              <HotKeyList hotkeys={['grpc_request.send', 'sidebar.focus', 'url_bar.focus']} />
            )}
          </div>
        )
      }
    />
  );
}
