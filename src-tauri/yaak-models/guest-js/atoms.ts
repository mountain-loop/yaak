import { atom } from 'jotai';

import { selectAtom } from 'jotai/utils';
import type { AnyModel } from '../bindings/gen_models';
import { ExtractModel } from './types';
import { newStoreData } from './util';

export const modelStoreDataAtom = atom(newStoreData());

export const cookieJarsAtom = createOrderedModelAtom('cookie_jar', 'name', 'asc');
export const environmentsAtom = createOrderedModelAtom('environment', 'name', 'asc');
export const foldersAtom = createModelAtom('folder');
export const grpcConnectionsAtom = createOrderedModelAtom('grpc_connection', 'createdAt', 'desc');
export const grpcEventsAtom = createOrderedModelAtom('grpc_event', 'createdAt', 'asc');
export const grpcRequestsAtom = createModelAtom('grpc_request');
export const httpRequestsAtom = createModelAtom('http_request');
export const httpResponsesAtom = createOrderedModelAtom('http_response', 'createdAt', 'desc');
export const keyValuesAtom = createModelAtom('key_value');
export const pluginsAtom = createModelAtom('plugin');
export const settingsAtom = createSingularModelAtom('settings');
export const websocketRequestsAtom = createModelAtom('websocket_request');
export const websocketEventsAtom = createOrderedModelAtom('websocket_event', 'createdAt', 'asc');
export const websocketConnectionsAtom = createOrderedModelAtom(
  'websocket_connection',
  'createdAt',
  'desc',
);
export const workspaceMetasAtom = createModelAtom('workspace_meta');
export const workspacesAtom = createOrderedModelAtom('workspace', 'name', 'asc');

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

export function createOrderedModelAtom<M extends AnyModel['model']>(
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
