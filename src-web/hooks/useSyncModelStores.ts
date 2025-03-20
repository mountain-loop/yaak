import deepEqual from '@gilbarbara/deep-equal';
import { useQueryClient } from '@tanstack/react-query';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { AnyModel, KeyValue, ModelPayload } from '@yaakapp-internal/models';
import { jotaiStore } from '../lib/jotai';
import { buildKeyValueKey } from '../lib/keyValueStore';
import { modelsEq } from '../lib/model_util';
import { getActiveWorkspaceId } from './useActiveWorkspace';
import { cookieJarsAtom } from './useCookieJars';
import { environmentsAtom } from './useEnvironments';
import { foldersAtom } from './useFolders';
import { grpcConnectionsAtom } from './useGrpcConnections';
import { grpcEventsQueryKey } from './useGrpcEvents';
import { grpcRequestsAtom } from './useGrpcRequests';
import { httpRequestsAtom } from './useHttpRequests';
import { httpResponsesAtom } from './useHttpResponses';
import { keyValueQueryKey, keyValuesAtom } from './useKeyValue';
import { useListenToTauriEvent } from './useListenToTauriEvent';
import { pluginsAtom } from './usePlugins';
import { useRequestUpdateKey } from './useRequestUpdateKey';
import { settingsAtom } from './useSettings';
import { websocketConnectionsAtom } from './useWebsocketConnections';
import { websocketEventsQueryKey } from './useWebsocketEvents';
import { websocketRequestsAtom } from './useWebsocketRequests';
import { workspaceMetaAtom } from './useWorkspaceMeta';
import { workspacesAtom } from './useWorkspaces';

export function useSyncModelStores() {
  const queryClient = useQueryClient();
  const { wasUpdatedExternally } = useRequestUpdateKey(null);

  useListenToTauriEvent<ModelPayload>('upserted_model', ({ payload }) => {
    const queryKey =
      payload.model.model === 'grpc_event'
        ? grpcEventsQueryKey(payload.model)
        : payload.model.model === 'websocket_event'
          ? websocketEventsQueryKey(payload.model)
          : payload.model.model === 'key_value'
            ? keyValueQueryKey(payload.model)
            : null;

    // TODO: Move this logic to useRequestEditor() hook
    if (
      (payload.model.model === 'http_request' ||
        payload.model.model === 'grpc_request' ||
        payload.model.model === 'websocket_request') &&
      ((payload.updateSource.type === 'window' &&
        payload.updateSource.label !== getCurrentWebviewWindow().label) ||
        payload.updateSource.type !== 'window')
    ) {
      wasUpdatedExternally(payload.model.id);
    }

    if (shouldIgnoreModel(payload)) return;

    if (payload.model.model === 'workspace') {
      jotaiStore.set(workspacesAtom, updateModelList(payload.model));
    } else if (payload.model.model === 'workspace_meta') {
      jotaiStore.set(workspaceMetaAtom, payload.model);
    } else if (payload.model.model === 'plugin') {
      jotaiStore.set(pluginsAtom, updateModelList(payload.model));
    } else if (payload.model.model === 'http_request') {
      jotaiStore.set(httpRequestsAtom, updateModelList(payload.model));
    } else if (payload.model.model === 'folder') {
      jotaiStore.set(foldersAtom, updateModelList(payload.model));
    } else if (payload.model.model === 'http_response') {
      jotaiStore.set(httpResponsesAtom, updateModelList(payload.model));
    } else if (payload.model.model === 'grpc_request') {
      jotaiStore.set(grpcRequestsAtom, updateModelList(payload.model));
    } else if (payload.model.model === 'websocket_request') {
      jotaiStore.set(websocketRequestsAtom, updateModelList(payload.model));
    } else if (payload.model.model === 'websocket_connection') {
      jotaiStore.set(websocketConnectionsAtom, updateModelList(payload.model));
    } else if (payload.model.model === 'grpc_connection') {
      jotaiStore.set(grpcConnectionsAtom, updateModelList(payload.model));
    } else if (payload.model.model === 'environment') {
      jotaiStore.set(environmentsAtom, updateModelList(payload.model));
    } else if (payload.model.model === 'cookie_jar') {
      jotaiStore.set(cookieJarsAtom, updateModelList(payload.model));
    } else if (payload.model.model === 'settings') {
      jotaiStore.set(settingsAtom, payload.model);
    } else if (payload.model.model === 'key_value') {
      jotaiStore.set(keyValuesAtom, updateModelList(payload.model));
    } else if (queryKey != null) {
      // TODO: Convert all models to use Jotai
      queryClient.setQueryData(queryKey, (current: unknown) => {
        if (Array.isArray(current)) {
          return updateModelList(payload.model)(current);
        }
      });
    }
  });

  useListenToTauriEvent<ModelPayload>('deleted_model', ({ payload }) => {
    if (shouldIgnoreModel(payload)) return;

    console.log('Delete model', payload);

    if (payload.model.model === 'workspace') {
      jotaiStore.set(workspacesAtom, removeModelById(payload.model));
    } else if (payload.model.model === 'plugin') {
      jotaiStore.set(pluginsAtom, removeModelById(payload.model));
    } else if (payload.model.model === 'http_request') {
      jotaiStore.set(httpRequestsAtom, removeModelById(payload.model));
    } else if (payload.model.model === 'http_response') {
      jotaiStore.set(httpResponsesAtom, removeModelById(payload.model));
    } else if (payload.model.model === 'folder') {
      jotaiStore.set(foldersAtom, removeModelById(payload.model));
    } else if (payload.model.model === 'environment') {
      jotaiStore.set(environmentsAtom, removeModelById(payload.model));
    } else if (payload.model.model === 'grpc_request') {
      jotaiStore.set(grpcRequestsAtom, removeModelById(payload.model));
    } else if (payload.model.model === 'websocket_request') {
      jotaiStore.set(websocketRequestsAtom, removeModelById(payload.model));
    } else if (payload.model.model === 'websocket_connection') {
      jotaiStore.set(websocketConnectionsAtom, removeModelById(payload.model));
    } else if (payload.model.model === 'websocket_event') {
      queryClient.setQueryData(
        websocketEventsQueryKey(payload.model),
        removeModelById(payload.model),
      );
    } else if (payload.model.model === 'grpc_connection') {
      jotaiStore.set(grpcConnectionsAtom, removeModelById(payload.model));
    } else if (payload.model.model === 'grpc_event') {
      queryClient.setQueryData(grpcEventsQueryKey(payload.model), removeModelById(payload.model));
    } else if (payload.model.model === 'key_value') {
      queryClient.setQueryData(keyValueQueryKey(payload.model), removeModelByKv(payload.model));
    } else if (payload.model.model === 'cookie_jar') {
      jotaiStore.set(cookieJarsAtom, removeModelById(payload.model));
    }
  });
}

export function updateModelList<T extends AnyModel>(model: T) {
  // Mark these models as DESC instead of ASC
  const pushToFront =
    model.model === 'http_response' ||
    model.model === 'grpc_connection' ||
    model.model === 'websocket_connection';

  return (current: T[] | undefined | null): T[] => {
    const index = current?.findIndex((v) => modelsEq(v, model)) ?? -1;
    const existingModel = current?.[index];
    if (existingModel && deepEqual(existingModel, model)) {
      // We already have the exact model, so do nothing
      return current;
    } else if (existingModel) {
      return [...(current ?? []).slice(0, index), model, ...(current ?? []).slice(index + 1)];
    } else {
      return pushToFront ? [model, ...(current ?? [])] : [...(current ?? []), model];
    }
  };
}

export function removeModelById<T extends { id: string }>(model: T) {
  return (prevEntries: T[] | undefined) => {
    const entries = prevEntries?.filter((e) => e.id !== model.id) ?? [];

    // Don't trigger an update if we didn't remove anything
    if (entries.length === (prevEntries ?? []).length) {
      return prevEntries ?? [];
    }

    return entries;
  };
}

export function removeModelByKv(model: KeyValue) {
  return (prevEntries: KeyValue[] | undefined) =>
    prevEntries?.filter(
      (e) =>
        !(
          e.namespace === model.namespace &&
          buildKeyValueKey(e.key) === buildKeyValueKey(model.key) &&
          e.value == model.value
        ),
    ) ?? [];
}

function shouldIgnoreModel({ model, updateSource }: ModelPayload) {
  console.log('HELLO', updateSource);
  // Never ignore updates from non-user sources
  if (updateSource.type !== 'window') {
    return false;
  }

  // Never ignore same-window updates
  if (updateSource.label === getCurrentWebviewWindow().label) {
    return false;
  }

  const activeWorkspaceId = getActiveWorkspaceId();
  // Only sync models that belong to this workspace, if a workspace ID is present
  if ('workspaceId' in model && model.workspaceId !== activeWorkspaceId) {
    return;
  }

  if (model.model === 'key_value') {
    return model.namespace === 'no_sync';
  }

  return false;
}
