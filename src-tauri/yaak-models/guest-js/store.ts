import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useAtomValue } from 'jotai';
import { AnyModel, ModelPayload, Workspace } from '../bindings/gen_models';
import {
  cookieJarsAtom,
  environmentsAtom,
  foldersAtom,
  grpcConnectionsAtom,
  grpcEventsAtom,
  grpcRequestsAtom,
  httpRequestsAtom,
  httpResponsesAtom,
  keyValuesAtom,
  modelStoreDataAtom,
  pluginsAtom,
  websocketConnectionsAtom,
  websocketEventsAtom,
  websocketRequestsAtom,
  workspaceMetasAtom,
  workspacesAtom,
} from './atoms';
import { ExtractModel, ExtractModels, JotaiStore, ModelStoreData } from './types';
import { newData } from './util';

let _store: JotaiStore | null = null;

export function initModelStore(store: JotaiStore) {
  _store = store;

  getCurrentWebviewWindow()
    .listen<ModelPayload>('upserted_model', ({ payload }) => {
      // TODO: Move this logic to useRequestEditor() hook
      if (
        (payload.model.model === 'http_request' ||
          payload.model.model === 'grpc_request' ||
          payload.model.model === 'websocket_request') &&
        ((payload.updateSource.type === 'window' &&
          payload.updateSource.label !== getCurrentWebviewWindow().label) ||
          payload.updateSource.type !== 'window')
      ) {
        // wasUpdatedExternally(payload.model.id);
      }

      if (shouldIgnoreModel(payload)) return;

      mustStore().set(modelStoreDataAtom, (prev: ModelStoreData) => {
        return {
          ...prev,
          [payload.model.model]: {
            ...prev[payload.model.model],
            [payload.model.id]: payload.model,
          },
        };
      });
    })
    .catch(console.error);

  getCurrentWebviewWindow()
    .listen<ModelPayload>('deleted_model', ({ payload }) => {
      if (shouldIgnoreModel(payload)) return;

      console.log('Delete model', payload);

      mustStore().set(modelStoreDataAtom, (prev: ModelStoreData) => {
        const modelData = { ...prev[payload.model.model] };
        delete modelData[payload.model.id];
        return { ...prev, [payload.model.model]: modelData };
      });
    })
    .catch(console.error);
}

function mustStore(): JotaiStore {
  if (_store == null) {
    throw new Error('Model store was not initialized');
  }

  return _store;
}

let _activeWorkspaceId: string | null = null;

export async function changeModelStoreWorkspace(workspaceId: string | null) {
  console.log('Syncing models with new workspace', workspaceId);
  const workspaceModels = await invoke<AnyModel[]>('plugin:yaak-models|workspace_models', {
    workspaceId, // NOTE: if no workspace id provided, it will just fetch global models
  });
  const data = newData();
  for (const model of workspaceModels) {
    data[model.model][model.id] = model;
  }

  mustStore().set(modelStoreDataAtom, data);

  console.log('Synced model store with workspace', workspaceId, data);

  _activeWorkspaceId = workspaceId;
}

const modelAtomMap = {
  cookie_jar: cookieJarsAtom,
  environment: environmentsAtom,
  folder: foldersAtom,
  grpc_connection: grpcConnectionsAtom,
  grpc_events: grpcEventsAtom,
  grpc_request: grpcRequestsAtom,
  http_request: httpRequestsAtom,
  http_response: httpResponsesAtom,
  key_value: keyValuesAtom,
  plugin: pluginsAtom,
  websocket_events: websocketEventsAtom,
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

export function getModel<M extends AnyModel['model'], T extends ExtractModel<AnyModel, M>>(
  modelType: M | M[],
  id: string,
): T | null {
  let data = mustStore().get(modelStoreDataAtom);
  for (const t of Array.isArray(modelType) ? modelType : [modelType]) {
    let v = data[t][id];
    if (v?.model === t) return v as T;
  }
  return null;
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

export async function deleteModelById<
  M extends AnyModel['model'],
  T extends ExtractModel<AnyModel, M>,
>(modelType: M | M[], id: string) {
  let model = getModel<M, T>(modelType, id);
  await deleteModel(model);
}

export async function deleteModel<M extends AnyModel['model'], T extends ExtractModel<AnyModel, M>>(
  model: T | null,
) {
  if (model == null) {
    throw new Error('Failed to delete null model');
  }
  await invoke<string>('plugin:yaak-models|delete', { model });
}

export async function createModel<T extends Workspace>(
  patch: Partial<T> & Pick<T, 'model'>,
): Promise<string> {
  return invoke<string>('plugin:yaak-models|upsert', { model: patch });
}

export async function createWorkspaceModel<T extends Extract<AnyModel, { workspaceId: string }>>(
  patch: Partial<T> & Pick<T, 'model' | 'workspaceId'>,
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

function shouldIgnoreModel({ model, updateSource }: ModelPayload) {
  // Never ignore updates from non-user sources
  if (updateSource.type !== 'window') {
    return false;
  }

  // Never ignore same-window updates
  if (updateSource.label === getCurrentWebviewWindow().label) {
    return false;
  }

  // Only sync models that belong to this workspace, if a workspace ID is present
  if ('workspaceId' in model && model.workspaceId !== _activeWorkspaceId) {
    return;
  }

  if (model.model === 'key_value') {
    return model.namespace === 'no_sync';
  }

  return false;
}
