import type { AnyModel } from "@yaakapp-internal/models";
import { foldersAtom } from "@yaakapp-internal/models";
import { resolvedModelName } from "@yaakapp-internal/ui/resolvedModelName";
import { jotaiStore } from "./jotai";

export { resolvedModelName };

export function resolvedModelNameWithFolders(model: AnyModel | null): string {
  return resolvedModelNameWithFoldersArray(model).join(" / ");
}

export function resolvedModelNameWithFoldersArray(model: AnyModel | null): string[] {
  if (model == null) return [];
  const folders = jotaiStore.get(foldersAtom) ?? [];

  const getParents = (m: AnyModel, names: string[]) => {
    let newNames = [...names, resolvedModelName(m)];
    if ("folderId" in m) {
      const parent = folders.find((f) => f.id === m.folderId);
      if (parent) {
        newNames = [...resolvedModelNameWithFoldersArray(parent), ...newNames];
      }
    }
    return newNames;
  };

  return getParents(model, []);
}
