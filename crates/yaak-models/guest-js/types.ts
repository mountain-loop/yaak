import { createStore } from 'jotai';
import { AnyModel } from '../bindings/gen_models';

export type ExtractModel<T, M> = T extends { model: M } ? T : never;
export type ModelStoreData<T extends AnyModel = AnyModel> = {
  [M in T['model']]: Record<string, Extract<T, { model: M }>>;
};
export type JotaiStore = ReturnType<typeof createStore>;
