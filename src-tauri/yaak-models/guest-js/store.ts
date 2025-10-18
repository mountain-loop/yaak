import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { AnyModel, ModelPayload } from '../bindings/gen_models';
import { modelStoreDataAtom } from './atoms';
import { ExtractModel, JotaiStore, ModelStoreData } from './types';
import { newStoreData } from './util';

let _store: JotaiStore | null = null;

export function initModelStore(store: JotaiStore) {
  _store = store;

  getCurrentWebviewWindow()
    .listen<ModelPayload>('upserted_model', ({ payload }) => {
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
  const workspaceModelsStr = await invoke<string>('plugin:yaak-models|workspace_models', {
    workspaceId, // NOTE: if no workspace id provided, it will just fetch global models
  });
  const workspaceModels = JSON.parse(workspaceModelsStr) as AnyModel[];
  const data = newStoreData();
  for (const model of workspaceModels) {
    data[model.model][model.id] = model;
  }

  mustStore().set(modelStoreDataAtom, data);

  console.log('Synced model store with workspace', workspaceId, data);

  _activeWorkspaceId = workspaceId;
}

export function getAnyModel(id: string): AnyModel | null {
  let data = mustStore().get(modelStoreDataAtom);
  for (const modelData of Object.values(data)) {
    let model = modelData[id];
    if (model != null) {
      return model;
    }
  }
  return null;
}

export function getModel<M extends AnyModel['model'], T extends ExtractModel<AnyModel, M>>(
  modelType: M | ReadonlyArray<M>,
  id: string,
): T | null {
  let data = mustStore().get(modelStoreDataAtom);
  const types: ReadonlyArray<M> = Array.isArray(modelType) ? modelType : [modelType];
  for (const t of types) {
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
  return updateModel(newModel);
}

export async function patchModel<M extends AnyModel['model'], T extends ExtractModel<AnyModel, M>>(
  base: Pick<T, 'id' | 'model'>,
  patch: Partial<T>,
): Promise<string> {
  return patchModelById<M, T>(base.model, base.id, patch);
}

export async function updateModel<M extends AnyModel['model'], T extends ExtractModel<AnyModel, M>>(
  model: T,
): Promise<string> {
  return invoke<string>('plugin:yaak-models|upsert', { model });
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

export function duplicateModelById<
  M extends AnyModel['model'],
  T extends ExtractModel<AnyModel, M>,
>(modelType: M | ReadonlyArray<M>, id: string) {
  let model = getModel<M, T>(modelType, id);
  return duplicateModel(model);
}

export function duplicateModel<M extends AnyModel['model'], T extends ExtractModel<AnyModel, M>>(
  model: T | null,
) {
  if (model == null) {
    throw new Error('Failed to delete null model');
  }
  if ('sortPriority' in model) model.sortPriority = model.sortPriority + 0.0001;

  return invoke<string>('plugin:yaak-models|duplicate', { model });
}

export async function createGlobalModel<T extends Exclude<AnyModel, { workspaceId: string }>>(
  patch: Partial<T> & Pick<T, 'model'>,
): Promise<string> {
  return invoke<string>('plugin:yaak-models|upsert', { model: patch });
}

export async function createWorkspaceModel<T extends Extract<AnyModel, { workspaceId: string }>>(
  patch: Partial<T> & Pick<T, 'model' | 'workspaceId'>,
): Promise<string> {
  return invoke<string>('plugin:yaak-models|upsert', { model: patch });
}

export function replaceModelsInStore<
  M extends AnyModel['model'],
  T extends Extract<AnyModel, { model: M }>,
>(model: M, models: T[]) {
  const newModels: Record<string, T> = {};
  for (const model of models) {
    newModels[model.id] = model;
  }

  mustStore().set(modelStoreDataAtom, (prev: ModelStoreData) => {
    return {
      ...prev,
      [model]: newModels,
    };
  });
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
    return true;
  }

  if (model.model === 'key_value' && model.namespace === 'no_sync') {
    return true;
  }

  return false;
}
