import { atom } from "jotai";
import { selectAtom } from "jotai/utils";

/** Any model must at least have an id. */
type BaseModel = { id: string };

/** The raw store shape: model type string → id → model instance. */
type StoreData<M extends BaseModel> = Record<string, Record<string, M>>;

export type ModelChange = { type: "upsert" } | { type: "delete" };

export function createModelStore<M extends BaseModel>() {
  const dataAtom = atom<StoreData<M>>({});

  /** Apply a single upsert or delete to the store. */
  function applyChange(
    prev: StoreData<M>,
    modelType: string,
    model: M,
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
  function listAtom(modelType: string) {
    return selectAtom(
      dataAtom,
      (data) => Object.values(data[modelType] ?? {}),
      shallowEqual,
    );
  }

  /** Atom that selects all models of a given type, sorted by a field. */
  function orderedListAtom<K extends keyof M>(
    modelType: string,
    field: K,
    order: "asc" | "desc",
  ) {
    return selectAtom(
      dataAtom,
      (data) => {
        const vals = Object.values(data[modelType] ?? {});
        return vals.sort((a, b) => {
          const n = a[field] > b[field] ? 1 : -1;
          return order === "desc" ? -n : n;
        });
      },
      shallowEqual,
    );
  }

  return { dataAtom, applyChange, listAtom, orderedListAtom };
}

function shallowEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
