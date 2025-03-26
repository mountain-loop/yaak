import { invoke } from '@tauri-apps/api/core';
import { AnyModel } from '../bindings/gen_models';
import { getModel } from './store';
import { ExtractModel } from './types';

export async function upsertModelFull(model: AnyModel): Promise<string> {
  return invoke<string>('plugin:yaak-models|upsert', { model });
}

export async function patchModelById<
  M extends AnyModel['model'],
  T extends ExtractModel<AnyModel, M>,
>(model: M, id: string, patch: Partial<T> | ((prev: T) => T)): Promise<string> {
  let prev = getModel<M, T>(model, id);
  if (prev == null) {
    throw new Error(`Failed to get model to patch id=${id} model=${model}`);
  }

  const newModel = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
  console.log("SENDING", newModel);
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
