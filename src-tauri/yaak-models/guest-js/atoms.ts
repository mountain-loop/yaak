import { atom } from 'jotai/index';
import type { Environment } from '../bindings/gen_models';
import { modelsFromData, modelStoreDataAtom } from './store';

export const environmentsAtom = atom(function (get) {
  return modelsFromData(get(modelStoreDataAtom), ['environment']);
});

export const sortedEnvironmentsAtom = atom(function (get) {
  return get(environmentsAtom).sort((a, b) => a.name.localeCompare(b.name));
});

export const environmentsBreakdownAtom = atom<{
  baseEnvironment: Environment | null;
  allEnvironments: Environment[];
  subEnvironments: Environment[];
}>(function (get) {
  const allEnvironments = get(sortedEnvironmentsAtom);
  const baseEnvironment = allEnvironments.find((e) => e.environmentId == null) ?? null;
  const subEnvironments =
    allEnvironments.filter((e) => e.environmentId === (baseEnvironment?.id ?? 'n/a')) ?? [];
  return { baseEnvironment, subEnvironments, allEnvironments } as const;
});

export const foldersAtom = atom(function (get) {
  return modelsFromData(get(modelStoreDataAtom), ['folder']);
});

export const httpRequestsAtom = atom(function (get) {
  return modelsFromData(get(modelStoreDataAtom), ['http_request']);
});

export const httpResponsesAtom = atom(function (get) {
  return modelsFromData(get(modelStoreDataAtom), ['http_response']).sort((a, b) =>
    a.createdAt > b.createdAt ? -1 : 1,
  );
});

export const grpcRequestsAtom = atom(function (get) {
  return modelsFromData(get(modelStoreDataAtom), ['grpc_request']);
});

export const grpcConnectionsAtom = atom(function (get) {
  return modelsFromData(get(modelStoreDataAtom), ['grpc_connection']).sort((a, b) =>
    a.createdAt > b.createdAt ? -1 : 1,
  );
});

export const settingsAtom = atom(function (get) {
  const settings = modelsFromData(get(modelStoreDataAtom), ['settings'])[0];
  if (settings == null) {
    throw new Error('Settings model has not been loaded');
  }
  return settings;
});

export const websocketRequestsAtom = atom(function (get) {
  return modelsFromData(get(modelStoreDataAtom), ['websocket_request']);
});

export const websocketConnectionsAtom = atom(function (get) {
  return modelsFromData(get(modelStoreDataAtom), ['websocket_connection']).sort((a, b) =>
    a.createdAt > b.createdAt ? -1 : 1,
  );
});

export const workspacesAtom = atom(function (get) {
  return modelsFromData(get(modelStoreDataAtom), ['workspace']);
});

export const pluginsAtom = atom(function (get) {
  return modelsFromData(get(modelStoreDataAtom), ['plugin']);
});

export const workspaceMetasAtom = atom(function (get) {
  return modelsFromData(get(modelStoreDataAtom), ['workspace_meta']);
});

export const sortedWorkspacesAtom = atom(function (get) {
  return get(workspacesAtom).sort((a, b) => a.name.localeCompare(b.name));
});

export const keyValuesAtom = atom(function (get) {
  return modelsFromData(get(modelStoreDataAtom), ['key_value']);
});

export const cookieJarsAtom = atom(function (get) {
  return modelsFromData(get(modelStoreDataAtom), ['cookie_jar']);
});

export const sortedCookieJars = atom(function (get) {
  return get(cookieJarsAtom)?.sort((a, b) => a.name.localeCompare(b.name));
});

export const requestsAtom = atom(function (get) {
  return modelsFromData(get(modelStoreDataAtom), [
    'http_request',
    'grpc_request',
    'websocket_request',
  ]);
});
