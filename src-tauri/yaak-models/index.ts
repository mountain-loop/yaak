import { invoke } from '@tauri-apps/api/core';
import type { AnyModel } from './bindings/gen_models';

export * from './bindings/gen_models';

export async function upsertAnyModel(model: AnyModel): Promise<String> {
  return invoke<String>('plugin:yaak-models|upsert', { model });
}
