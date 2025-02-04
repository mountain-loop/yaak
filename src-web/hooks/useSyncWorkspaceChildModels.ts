import {listWebsocketConnections, listWebsocketRequests} from '@yaakapp-internal/ws';
import { useEffect } from 'react';
import { jotaiStore } from '../lib/jotai';
import { invokeCmd } from '../lib/tauri';
import { activeWorkspaceIdAtom, getActiveWorkspaceId } from './useActiveWorkspace';
import { cookieJarsAtom } from './useCookieJars';
import { environmentsAtom } from './useEnvironments';
import { foldersAtom } from './useFolders';
import { grpcConnectionsAtom } from './useGrpcConnections';
import { grpcRequestsAtom } from './useGrpcRequests';
import { httpRequestsAtom } from './useHttpRequests';
import { httpResponsesAtom } from './useHttpResponses';
import { keyValuesAtom } from './useKeyValue';
import {websocketConnectionsAtom} from "./useWebsocketConnections";
import { websocketRequestsAtom } from './useWebsocketRequests';
import { workspaceMetaAtom } from './useWorkspaceMeta';

export function useSyncWorkspaceChildModels() {
  useEffect(() => {
    const unsub = jotaiStore.sub(activeWorkspaceIdAtom, sync);
    sync().catch(console.error);
    return unsub;
  }, []);
}

async function sync() {
  // Doesn't need a workspace ID, so sync it right away
  jotaiStore.set(keyValuesAtom, await invokeCmd('cmd_list_key_values'));

  const workspaceId = getActiveWorkspaceId();
  if (workspaceId == null) return;

  const args = { workspaceId };

  // Set the things we need first, first
  jotaiStore.set(httpRequestsAtom, await invokeCmd('cmd_list_http_requests', args));
  jotaiStore.set(grpcRequestsAtom, await invokeCmd('cmd_list_grpc_requests', args));
  jotaiStore.set(foldersAtom, await invokeCmd('cmd_list_folders', args));
  jotaiStore.set(websocketRequestsAtom, await listWebsocketRequests(args));

  // Then, set the rest
  jotaiStore.set(cookieJarsAtom, await invokeCmd('cmd_list_cookie_jars', args));
  jotaiStore.set(httpResponsesAtom, await invokeCmd('cmd_list_http_responses', args));
  jotaiStore.set(grpcConnectionsAtom, await invokeCmd('cmd_list_grpc_connections', args));
  jotaiStore.set(websocketConnectionsAtom, await listWebsocketConnections(args));
  jotaiStore.set(environmentsAtom, await invokeCmd('cmd_list_environments', args));

  // Single models
  jotaiStore.set(workspaceMetaAtom, await invokeCmd('cmd_get_workspace_meta', { workspaceId }));
}
