import { atom } from 'jotai';

import { selectAtom } from 'jotai/utils';
import type { AnyModel, Environment } from '../bindings/gen_models';
import { ExtractModel } from './types';
import { newData } from './util';

export const modelStoreDataAtom = atom(newData());

export const environmentsAtom = createModelAtom('environment');
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

export const foldersAtom = createModelAtom('folder');
export const httpRequestsAtom = createModelAtom('http_request');
export const httpResponsesAtom = createSortedModelAtom('http_response', 'createdAt', 'desc');
export const grpcRequestsAtom = createModelAtom('grpc_request');
export const grpcConnectionsAtom = createSortedModelAtom('grpc_connection', 'createdAt', 'desc');
export const grpcEventsAtom = createSortedModelAtom('grpc_event', 'createdAt', 'desc');
export const settingsAtom = createSingularModelAtom('settings');
export const websocketRequestsAtom = createModelAtom('websocket_request');
export const websocketEventsAtom = createSortedModelAtom('websocket_event', 'createdAt', 'desc');
export const websocketConnectionsAtom = createModelAtom('websocket_connection');
export const workspacesAtom = createModelAtom('workspace');
export const pluginsAtom = createModelAtom('plugin');
export const workspaceMetasAtom = createModelAtom('workspace_meta');

export const sortedWorkspacesAtom = atom(function (get) {
  return get(workspacesAtom).sort((a, b) => a.name.localeCompare(b.name));
});

export const keyValuesAtom = createModelAtom('key_value');
export const cookieJarsAtom = createModelAtom('cookie_jar');

export const sortedCookieJars = atom(function (get) {
  return get(cookieJarsAtom)?.sort((a, b) => a.name.localeCompare(b.name));
});

export const requestsAtom = atom(function (get) {
  return [...get(httpRequestsAtom), ...get(grpcRequestsAtom), ...get(websocketRequestsAtom)];
});

export function createModelAtom<M extends AnyModel['model']>(modelType: M) {
  return selectAtom(
    modelStoreDataAtom,
    (data) => Object.values(data[modelType] ?? {}),
    shallowEqual,
  );
}

export function createSingularModelAtom<M extends AnyModel['model']>(modelType: M) {
  return selectAtom(modelStoreDataAtom, (data) => {
    const modelData = Object.values(data[modelType] ?? {});
    const item = modelData[0];
    if (item == null) throw new Error('Failed creating singular model with no data: ' + modelType);
    return item;
  });
}

export function createSortedModelAtom<M extends AnyModel['model']>(
  modelType: M,
  field: keyof ExtractModel<AnyModel, M>,
  order: 'asc' | 'desc',
) {
  return selectAtom(
    modelStoreDataAtom,
    (data) => {
      const modelData = data[modelType] ?? {};
      return Object.values(modelData).sort(
        (a: ExtractModel<AnyModel, M>, b: ExtractModel<AnyModel, M>) => {
          const n = a[field] > b[field] ? 1 : -1;
          return order === 'desc' ? n * -1 : n;
        },
      );
    },
    shallowEqual,
  );
}

function shallowEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }

  return true;
}
