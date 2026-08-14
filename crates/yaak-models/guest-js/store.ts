import { platform } from "@yaakapp-internal/platform";
import { debounce } from "@yaakapp-internal/lib";
import { AnyModel, ModelPayload } from "../bindings/gen_models";
import { modelStoreDataAtom } from "./atoms";
import { ExtractModel, JotaiStore, ModelStoreData } from "./types";
import { newStoreData } from "./util";

let _store: JotaiStore | null = null;

const pendingModelWrites = new Set<Promise<unknown>>();

export function initModelStore(store: JotaiStore) {
  _store = store;

  // Don't lose debounced patches if the window closes while one is pending
  window.addEventListener("beforeunload", flushAllPendingPatches);

  platform.listen<ModelPayload[]>("model_writes", (payloads) => {
    mustStore().set(modelStoreDataAtom, (prev: ModelStoreData) => {
      // Apply the entire batch in one update, cloning each touched bucket only
      // once. Bulk writes (imports, sync, CLI) can carry hundreds of models.
      const next = { ...prev };
      const clonedBuckets = new Set<AnyModel["model"]>();
      let changed = false;

      for (const payload of payloads) {
        if (shouldIgnoreModel(payload)) continue;
        if (isUnsafeObjectKey(payload.model.model)) continue;
        if (isUnsafeObjectKey(payload.model.id)) continue;

        if (payload.change.type === "upsert") {
          const modelType = payload.model.model;
          if (!clonedBuckets.has(modelType)) {
            next[modelType] = { ...next[modelType] } as never;
            clonedBuckets.add(modelType);
          }
          (next[modelType] as Record<string, AnyModel>)[payload.model.id] = payload.model;
          changed = true;
        } else {
          changed = applyModelDelete(next, clonedBuckets, payload.model) || changed;
        }
      }

      return changed ? next : prev;
    });
  });
}

/**
 * Model buckets are plain objects keyed by model id, so ids that collide with
 * Object.prototype members ("__proto__" etc.) could pollute the prototype.
 * Real model ids are backend-generated and never look like this.
 */
function isUnsafeObjectKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function deleteFromBucket(
  next: ModelStoreData,
  clonedBuckets: Set<AnyModel["model"]>,
  modelType: AnyModel["model"],
  id: string,
): boolean {
  if (isUnsafeObjectKey(modelType)) return false;
  if (isUnsafeObjectKey(id)) return false;
  if (!Object.prototype.hasOwnProperty.call(next[modelType], id)) return false;
  if (!clonedBuckets.has(modelType)) {
    next[modelType] = { ...next[modelType] } as never;
    clonedBuckets.add(modelType);
  }
  delete (next[modelType] as Record<string, AnyModel>)[id];
  return true;
}

/**
 * Apply a model delete to store data, mutating `next` in place (buckets are
 * cloned once, tracked via `clonedBuckets`). A workspace delete implies its
 * entire subtree: the backend bulk-deletes children and records/emits only the
 * workspace event (see ModelChangeEvent), so prune them here.
 */
function applyModelDelete(
  next: ModelStoreData,
  clonedBuckets: Set<AnyModel["model"]>,
  model: AnyModel,
): boolean {
  let changed = deleteFromBucket(next, clonedBuckets, model.model, model.id);

  if (model.model === "workspace") {
    for (const modelType of Object.keys(next) as AnyModel["model"][]) {
      const bucket = next[modelType] as Record<string, AnyModel>;
      for (const [id, m] of Object.entries(bucket)) {
        if ("workspaceId" in m && m.workspaceId === model.id) {
          changed = deleteFromBucket(next, clonedBuckets, modelType, id) || changed;
        }
      }
    }
  }

  return changed;
}

function mustStore(): JotaiStore {
  if (_store == null) {
    throw new Error("Model store was not initialized");
  }

  return _store;
}

function trackModelWrite<T>(write: Promise<T>): Promise<T> {
  const tracked = write.finally(() => {
    pendingModelWrites.delete(tracked);
  });

  pendingModelWrites.add(tracked);
  return tracked;
}

export async function flushAllModelWrites(): Promise<void> {
  flushAllPendingPatches();
  const results = await Promise.allSettled(pendingModelWrites);
  const rejected = results.find((result) => result.status === "rejected");
  if (rejected?.status === "rejected") {
    throw rejected.reason;
  }
}

const PATCH_DEBOUNCE_MS = 400;

interface PendingPatch {
  model: AnyModel["model"];
  id: string;
  patch: Record<string, unknown>;
  write: ReturnType<typeof debounce>;
}

const pendingPatches = new Map<string, PendingPatch>();

/**
 * Like patchModel, but coalesces rapid patches to the same model (eg. one per
 * keystroke) into a single write. Later fields overwrite earlier ones, so it's
 * only safe for whole-value fields like url, body, or headers. Pending patches
 * flush after a short delay, and flushAllModelWrites() (called before sends and
 * duplicates) flushes them immediately.
 */
export function patchModelDebounced<
  M extends AnyModel["model"],
  T extends ExtractModel<AnyModel, M>,
>(base: Pick<T, "id" | "model">, patch: Partial<T>): void {
  const key = `${base.model}.${base.id}`;
  let pending = pendingPatches.get(key);
  if (pending == null) {
    pending = {
      model: base.model,
      id: base.id,
      patch: {},
      write: debounce(() => writePendingPatch(key), PATCH_DEBOUNCE_MS),
    };
    pendingPatches.set(key, pending);
  }
  pending.patch = { ...pending.patch, ...patch };
  pending.write();
}

function writePendingPatch(key: string) {
  const pending = pendingPatches.get(key);
  if (pending == null) return;
  pendingPatches.delete(key);
  try {
    void patchModelById(pending.model, pending.id, pending.patch);
  } catch (err) {
    // Model may have been deleted while the patch was pending
    console.warn("Failed to flush pending patch", key, err);
  }
}

export function flushAllPendingPatches() {
  for (const pending of Array.from(pendingPatches.values())) {
    pending.write.flush();
  }
}

/**
 * Apply a model's pending patch, if it has one that hasn't been written yet.
 *
 * The store only moves forward when the backend echoes a write back, so between a keystroke and
 * its debounced write the stored copy is behind what the user typed. Reading through the pending
 * patch keeps that window invisible to the imperative readers below, which are the ones that go
 * on to write the model back.
 */
function withPendingPatch<T>(model: T | null): T | null {
  if (model == null || pendingPatches.size === 0) return model;
  const { model: modelType, id } = model as { model?: string; id?: string };
  const pending = pendingPatches.get(`${modelType}.${id}`);
  return pending == null ? model : ({ ...model, ...pending.patch } as T);
}

/** Drop a model's pending patch and cancel its scheduled write */
function consumePendingPatch(model: AnyModel["model"], id: string) {
  const key = `${model}.${id}`;
  const pending = pendingPatches.get(key);
  if (pending == null) return;
  pending.write.cancel();
  pendingPatches.delete(key);
}

let _activeWorkspaceId: string | null = null;

export async function changeModelStoreWorkspace(workspaceId: string | null) {
  console.log("Syncing models with new workspace", workspaceId);
  const workspaceModelsStr = await platform.rpc<string>("models_workspace_models", {
    workspaceId, // NOTE: if no workspace id provided, it will just fetch global models
  });
  const workspaceModels = JSON.parse(workspaceModelsStr) as AnyModel[];
  const data = newStoreData();
  for (const model of workspaceModels) {
    data[model.model][model.id] = model;
  }

  mustStore().set(modelStoreDataAtom, data);

  console.log("Synced model store with workspace", workspaceId, data);

  _activeWorkspaceId = workspaceId;
}

export function listModels<M extends AnyModel["model"], T extends ExtractModel<AnyModel, M>>(
  modelType: M | ReadonlyArray<M>,
): T[] {
  let data = mustStore().get(modelStoreDataAtom);
  const types: ReadonlyArray<M> = Array.isArray(modelType) ? modelType : [modelType];
  return types.flatMap((t) => Object.values(data[t]) as T[]);
}

export function getModel<M extends AnyModel["model"], T extends ExtractModel<AnyModel, M>>(
  modelType: M | ReadonlyArray<M>,
  id: string,
): T | null {
  let data = mustStore().get(modelStoreDataAtom);
  const types: ReadonlyArray<M> = Array.isArray(modelType) ? modelType : [modelType];
  for (const t of types) {
    let v = data[t][id];
    if (v?.model === t) return withPendingPatch(v as T);
  }
  return null;
}

export function getAnyModel(id: string): AnyModel | null {
  let data = mustStore().get(modelStoreDataAtom);
  for (const t of Object.keys(data)) {
    // oxlint-disable-next-line no-explicit-any -- dynamic key access
    let v = (data as any)[t]?.[id];
    if (v?.model === t) return withPendingPatch(v);
  }
  return null;
}

export function patchModelById<M extends AnyModel["model"], T extends ExtractModel<AnyModel, M>>(
  model: M,
  id: string,
  patch: Partial<T> | ((prev: T) => T),
): Promise<string> {
  // Reads through any pending debounced patch, so the merge below can't put a stale value back
  // over something the user has already typed
  let prev = getModel<M, T>(model, id);
  if (prev == null) {
    throw new Error(`Failed to get model to patch id=${id} model=${model}`);
  }

  // `prev` already carries the pending patch, so this write supersedes it. Leaving it queued
  // would let it land afterwards and undo whatever this write decided.
  consumePendingPatch(model, id);

  const newModel = typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
  return updateModel(newModel);
}

export async function patchModel<M extends AnyModel["model"], T extends ExtractModel<AnyModel, M>>(
  base: Pick<T, "id" | "model">,
  patch: Partial<T>,
): Promise<string> {
  return patchModelById<M, T>(base.model, base.id, patch);
}

export async function updateModel<M extends AnyModel["model"], T extends ExtractModel<AnyModel, M>>(
  model: T,
): Promise<string> {
  return trackModelWrite(platform.rpc<string>("models_upsert", { model }));
}

export async function deleteModelById<
  M extends AnyModel["model"],
  T extends ExtractModel<AnyModel, M>,
>(modelType: M | M[], id: string) {
  let model = getModel<M, T>(modelType, id);
  await deleteModel(model);
}

export async function deleteModel<M extends AnyModel["model"], T extends ExtractModel<AnyModel, M>>(
  model: T | null,
) {
  if (model == null) {
    throw new Error("Failed to delete null model");
  }
  await trackModelWrite(platform.rpc<string>("models_delete", { model }));

  // Apply the delete locally right away so callers can rely on the store once the
  // promise resolves. The backend echo arrives async, so anything that reads the
  // store immediately after awaiting (e.g. redirecting away from a deleted
  // workspace) would otherwise race it. The echo re-applying later is a no-op.
  mustStore().set(modelStoreDataAtom, (prev: ModelStoreData) => {
    const next = { ...prev };
    return applyModelDelete(next, new Set(), model as AnyModel) ? next : prev;
  });
}

export async function duplicateModel<
  M extends AnyModel["model"],
  T extends ExtractModel<AnyModel, M>,
>(model: T | null): Promise<string> {
  if (model == null) {
    throw new Error("Failed to duplicate null model");
  }

  // Flush pending writes first, since the backend duplicates from the DB (the passed-in
  // model may be a stale snapshot, eg. from the memoized sidebar tree). Conflict-free
  // naming ("Foo Copy 2") is also handled by the backend.
  await flushAllModelWrites();

  return trackModelWrite(
    platform.rpc<string>("models_duplicate", { modelType: model.model, modelId: model.id }),
  );
}

export async function createGlobalModel<T extends Exclude<AnyModel, { workspaceId: string }>>(
  patch: Partial<T> & Pick<T, "model">,
): Promise<string> {
  return trackModelWrite(platform.rpc<string>("models_upsert", { model: patch }));
}

export async function createWorkspaceModel<T extends Extract<AnyModel, { workspaceId: string }>>(
  patch: Partial<T> & Pick<T, "model" | "workspaceId">,
): Promise<string> {
  return trackModelWrite(platform.rpc<string>("models_upsert", { model: patch }));
}

export function replaceModelsInStore<
  M extends AnyModel["model"],
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

export function mergeModelsInStore<
  M extends AnyModel["model"],
  T extends Extract<AnyModel, { model: M }>,
>(model: M, models: T[], filter?: (model: T) => boolean) {
  mustStore().set(modelStoreDataAtom, (prev: ModelStoreData) => {
    const existingModels = { ...prev[model] } as Record<string, T>;

    // Merge in new models first
    for (const m of models) {
      existingModels[m.id] = m;
    }

    // Then filter out unwanted models
    if (filter) {
      for (const [id, m] of Object.entries(existingModels)) {
        if (!filter(m)) {
          delete existingModels[id];
        }
      }
    }

    return {
      ...prev,
      [model]: existingModels,
    };
  });
}

function shouldIgnoreModel({ model, updateSource }: ModelPayload) {
  // Never ignore updates from non-user sources
  if (updateSource.type !== "window") {
    return false;
  }

  // Never ignore same-window updates
  if (updateSource.label === platform.window.label) {
    return false;
  }

  // Only sync models that belong to this workspace, if a workspace ID is present
  if ("workspaceId" in model && model.workspaceId !== _activeWorkspaceId) {
    return true;
  }

  if (model.model === "key_value" && model.namespace === "no_sync") {
    return true;
  }

  return false;
}
