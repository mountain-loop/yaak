import { atom } from "jotai";
import { selectAtom } from "jotai/utils";

/** Model map: each key is a model type name, each value is the model shape (must have id). */
type ModelMap = Record<string, { id: string }>;

/** The store data shape derived from the model map. */
type StoreData<M extends ModelMap> = {
  [K in keyof M]: Record<string, M[K]>;
};

export type ModelChange = { type: "upsert" } | { type: "delete" };

function emptyStore<M extends ModelMap>(keys: (keyof M)[]): StoreData<M> {
  const data = {} as StoreData<M>;
  for (const k of keys) {
    data[k] = {} as Record<string, M[typeof k]>;
  }
  return data;
}

export function createModelStore<M extends ModelMap>(
  modelTypes: (keyof M & string)[],
) {
  const dataAtom = atom<StoreData<M>>(emptyStore<M>(modelTypes));

  /** Apply a single upsert or delete to the store. */
  function applyChange<K extends keyof M & string>(
    prev: StoreData<M>,
    modelType: K,
    model: M[K],
    change: ModelChange,
  ): StoreData<M> {
    if (change.type === "upsert") {
      return {
        ...prev,
        [modelType]: { ...prev[modelType], [model.id]: model },
      };
    } else {
      const bucket = { ...prev[modelType] };
      delete bucket[model.id];
      return { ...prev, [modelType]: bucket };
    }
  }

  /** Atom that selects all models of a given type as an array. */
  function listAtom<K extends keyof M & string>(modelType: K) {
    return selectAtom(
      dataAtom,
      (data) => Object.values(data[modelType] ?? {}) as M[K][],
      shallowEqual,
    );
  }

  /** Atom that selects all models of a given type, sorted by a field. */
  function orderedListAtom<K extends keyof M & string>(
    modelType: K,
    field: keyof M[K],
    order: "asc" | "desc",
  ) {
    return selectAtom(
      dataAtom,
      (data) => {
        const vals = Object.values(data[modelType] ?? {}) as M[K][];
        return vals.sort((a, b) => {
          const n = a[field] > b[field] ? 1 : -1;
          return order === "desc" ? -n : n;
        });
      },
      shallowEqual,
    );
  }

  /** Replace all models of a given type. Used for initial hydration. */
  function replaceAll<K extends keyof M & string>(
    prev: StoreData<M>,
    modelType: K,
    models: M[K][],
  ): StoreData<M> {
    const bucket = {} as Record<string, M[K]>;
    for (const m of models) {
      bucket[m.id] = m;
    }
    return { ...prev, [modelType]: bucket };
  }

  return { dataAtom, applyChange, replaceAll, listAtom, orderedListAtom };
}

function shallowEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
