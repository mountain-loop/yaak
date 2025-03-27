import { invoke } from '@tauri-apps/api/core';
import { AnyModel } from '../bindings/gen_models';

export async function upsertModelFull(model: AnyModel): Promise<string> {
  return invoke<string>('plugin:yaak-models|upsert', { model });
}
