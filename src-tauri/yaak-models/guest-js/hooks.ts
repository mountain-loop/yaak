import { useAtomValue } from 'jotai';
import { AnyModel } from '../bindings/gen_models';
import { getModelFromStore, modelStoreAtom } from './store';

function useStore() {
  return useAtomValue(modelStoreAtom);
}

export function useModelList(model: AnyModel['model']) {
  return Object.values(useStore()).filter((m) => m.model === model);
}

export function useModelById<M extends AnyModel['model']>(model: M, id: string) {
  const store = useStore();
  return getModelFromStore(store, model, id);
}
