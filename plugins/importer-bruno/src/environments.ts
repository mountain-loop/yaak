import type { PartialImportResources } from "@yaakapp/api";
import { rows, text, variables, type Obj } from "./common";

export function environments(
  value: unknown,
  workspaceId: string,
  id: () => string,
): PartialImportResources["environments"] {
  const source = rows(value);
  const byName = new Map(source.map((e) => [text(e.name), e]));
  const resolve = (env: Obj, seen = new Set<Obj>()): ReturnType<typeof variables> => {
    if (seen.has(env)) throw new Error("Bruno environment inheritance contains a cycle");
    if (seen.size > 100) throw new Error("Bruno environment inheritance is too deeply nested");
    seen.add(env);
    const own = variables(env.variables);
    const parentName = text(env.extends);
    if (!parentName) return own;
    const parent = byName.get(parentName);
    if (!parent)
      throw new Error(
        `Bruno environment "${text(env.name)}" extends missing environment "${parentName}"`,
      );
    const overrides = new Set(own.filter((v) => v.enabled).map((v) => v.name));
    return [...resolve(parent, seen).filter((v) => v.enabled && !overrides.has(v.name)), ...own];
  };
  // Yaak has one level of selectable environments. Flatten Bruno's extends chain so
  // inheritance survives the host clearing environment parent IDs during import.
  return source.map((e, sortPriority) => ({
    model: "environment",
    id: id(),
    workspaceId,
    name: text(e.name) || "Environment",
    parentModel: "environment",
    parentId: null,
    variables: resolve(e),
    color: text(e.color) || null,
    sortPriority,
  }));
}
