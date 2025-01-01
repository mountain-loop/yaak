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

export function useSyncWorkspaceChildModels() {
  useEffect(() => {
    jotaiStore.sub(activeWorkspaceIdAtom, sync);
    sync().catch(console.error);
  }, []);
}

async function sync() {
  const workspaceId = getActiveWorkspaceId();
  const args = { workspaceId };
  console.log('Syncing model stores', args);
  // Set the things we need first, first
  jotaiStore.set(httpRequestsAtom, await invokeCmd('cmd_list_http_requests', args));
  jotaiStore.set(grpcRequestsAtom, await invokeCmd('cmd_list_grpc_requests', args));
  jotaiStore.set(foldersAtom, await invokeCmd('cmd_list_folders', args));

  // Then, set the rest
  jotaiStore.set(keyValuesAtom, await invokeCmd('cmd_list_key_values', args));
  jotaiStore.set(cookieJarsAtom, await invokeCmd('cmd_list_cookie_jars', args));
  jotaiStore.set(httpResponsesAtom, await invokeCmd('cmd_list_http_responses', args));
  jotaiStore.set(grpcConnectionsAtom, await invokeCmd('cmd_list_grpc_connections', args));
  jotaiStore.set(environmentsAtom, await invokeCmd('cmd_list_environments', args));
}
