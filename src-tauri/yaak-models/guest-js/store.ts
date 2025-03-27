import { invoke } from '@tauri-apps/api/core';
import { atom, createStore, useAtomValue } from 'jotai';
import { AnyModel } from '../bindings/gen_models';
import {
  cookieJarsAtom,
  environmentsAtom,
  foldersAtom,
  grpcConnectionsAtom,
  grpcRequestsAtom,
  httpRequestsAtom,
  httpResponsesAtom,
  keyValuesAtom,
  pluginsAtom,
  websocketConnectionsAtom,
  websocketRequestsAtom,
  workspaceMetasAtom,
  workspacesAtom,
} from './atoms';
import { ExtractModel, ExtractModels } from './types';

type ModelStoreData<T extends AnyModel = AnyModel> = {
  [M in T['model']]: Record<string, Extract<T, { model: M }>>;
};
type JotaiStore = ReturnType<typeof createStore>;

export const modelStoreDataAtom = atom(newData());

let _store: JotaiStore | null = null;

export function initModelStore(store: JotaiStore) {
  _store = store;
}

function mustStore(): JotaiStore {
  if (_store == null) {
    throw new Error('Model store was not initialized');
  }

  return _store;
}

export async function changeModelStoreWorkspace(workspaceId: string | null) {
  const workspaceModels = await invoke<AnyModel[]>('plugin:yaak-models|workspace_models', {
    workspaceId, // NOTE: if no workspace id provided, it will just fetch global models
  });
  const data = newData();
  for (const model of workspaceModels) {
    data[model.model][model.id] = model;
  }

  mustStore().set(modelStoreDataAtom, data);

  console.log('Synced model store', data);
}

const modelAtomMap = {
  cookie_jar: cookieJarsAtom,
  environment: environmentsAtom,
  folder: foldersAtom,
  grpc_connection: grpcConnectionsAtom,
  grpc_request: grpcRequestsAtom,
  http_request: httpRequestsAtom,
  http_response: httpResponsesAtom,
  key_value: keyValuesAtom,
  plugin: pluginsAtom,
  websocket_request: websocketRequestsAtom,
  websocket_connection: websocketConnectionsAtom,
  workspace: workspacesAtom,
  workspace_meta: workspaceMetasAtom,
} as const;

type ModelToAtomMap = typeof modelAtomMap;
type ModelName = keyof ModelToAtomMap;
type AtomReturn<T> = T extends import('jotai').Atom<infer R> ? R : never;

export function useModelList<M extends ModelName>(model: M): AtomReturn<ModelToAtomMap[M]> {
  if (!(model in modelAtomMap)) {
    throw new Error('Cannot list models for ' + model);
  }

  const atom = modelAtomMap[model];
  return useAtomValue(atom);
}

export function useModelById<M extends AnyModel['model'], T extends ExtractModel<AnyModel, M>>(
  models: M | M[],
  id: string,
) {
  let data = useAtomValue(modelStoreDataAtom);
  return modelFromData<M, T>(data, models, id);
}

export function getModel<M extends AnyModel['model'], T extends ExtractModel<AnyModel, M>>(
  model: M | M[],
  id: string,
): T | null {
  let data = mustStore().get(modelStoreDataAtom);
  return modelFromData(data, model, id);
}

export function patchModelById<M extends AnyModel['model'], T extends ExtractModel<AnyModel, M>>(
  model: M,
  id: string,
  patch: Partial<T> | ((prev: T) => T),
): Promise<string> {
  let prev = getModel<M, T>(model, id);
  if (prev == null) {
    throw new Error(`Failed to get model to patch id=${id} model=${model}`);
  }

  const newModel = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
  return invoke<string>('plugin:yaak-models|upsert', { model: newModel });
}

export async function patchModel<M extends AnyModel['model'], T extends ExtractModel<AnyModel, M>>(
  base: Pick<T, 'id' | 'model'>,
  patch: Partial<T>,
): Promise<string> {
  return patchModelById<M, T>(base.model, base.id, patch);
}

export async function createModel<T extends AnyModel>(
  patch: Partial<T> & Pick<T, 'model'>,
): Promise<string> {
  return invoke<string>('plugin:yaak-models|upsert', { model: patch });
}

export function listModels<M extends AnyModel['model']>(
  models: M | M[],
): ExtractModels<AnyModel, M>[] {
  const data = mustStore().get(modelStoreDataAtom);
  return modelsFromData(data, models);
}

export function modelsFromData<M extends AnyModel['model'], T extends ExtractModels<AnyModel, M>>(
  data: ModelStoreData,
  models: M | M[],
): T[] {
  const values: T[] = [];
  for (const model of Array.isArray(models) ? models : [models]) {
    values.push(...(Object.values(data[model]) as T[]));
  }
  return values;
}

export function replaceModelInData(data: ModelStoreData, value: AnyModel): ModelStoreData {
  const newData = structuredClone(data);
  newData[value.model][value.id] = value;
  return newData;
}

export function removeModelInData(data: ModelStoreData, value: AnyModel): ModelStoreData {
  data[value.model][value.id] = value;
  return data;
}

export function modelFromData<M extends AnyModel['model'], T extends ExtractModel<AnyModel, M>>(
  data: ModelStoreData,
  models: M | M[],
  id: string,
): T | null {
  for (const model of Array.isArray(models) ? models : [models]) {
    let v = data[model][id];
    if (v?.model === model) return v as T;
  }
  return null;
}

function newData(): ModelStoreData {
  return {
    cookie_jar: {},
    environment: {},
    folder: {},
    grpc_connection: {},
    grpc_event: {},
    grpc_request: {},
    http_request: {},
    http_response: {},
    key_value: {},
    plugin: {},
    settings: {},
    sync_state: {},
    websocket_connection: {},
    websocket_event: {},
    websocket_request: {},
    workspace: {},
    workspace_meta: {},
  };
}
