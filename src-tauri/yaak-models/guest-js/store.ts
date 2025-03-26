import { invoke } from '@tauri-apps/api/core';
import { atom, getDefaultStore } from 'jotai/index';
import { AnyModel } from '../bindings/gen_models';
import { ExtractModel } from './types';

type ModelStore = Record<string, AnyModel>;
export const modelStoreAtom = atom<ModelStore>({});

export function initModelStore(workspaceId: string) {
  sync(workspaceId).catch(console.error);
}

export function getModelStore() {
  return getDefaultStore().get(modelStoreAtom);
}

export function getModel<M extends AnyModel['model'], T extends ExtractModel<AnyModel, M>>(
  model: M,
  id: string,
): T | null {
  return getModelFromStore<M, T>(getModelStore(), model, id);
}

export function getModelFromStore<M extends AnyModel['model'], T extends ExtractModel<AnyModel, M>>(
  store: ModelStore,
  model: M,
  id: string,
): T | null {
  let v = store[id];
  if (v?.model === model) return v as T;
  return null;
}

async function sync(workspaceId: string) {
  const models = await invoke<AnyModel[]>('plugin:yaak-models|workspace_models', { workspaceId });
  const newModelStore: ModelStore = {};
  for (const model of models) {
    newModelStore[model.id] = model;
  }

  getDefaultStore().set(modelStoreAtom, newModelStore);

  console.log('Synced model store', newModelStore);
}
