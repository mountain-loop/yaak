import type { EnvironmentVariable, HttpRequestHeader } from "@yaakapp/api";
import YAML from "yaml";

export type Obj = Record<string, unknown>;
export function object(value: unknown): Obj {
  return value != null && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {};
}
export function rows(value: unknown): Obj[] {
  return Array.isArray(value) ? value.map(object) : [];
}
export function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export function template(value: unknown): string {
  return text(value).replace(/{{\s*([^{}]+?)\s*}}/g, (full, name: string) => {
    // Bruno's expressions, process.env and dynamic variables have different semantics.
    if (
      name.startsWith("process.env.") ||
      ["true", "false", "null"].includes(name) ||
      !/^[\p{L}_][\p{L}\p{N}_.-]*$/u.test(name)
    )
      return full;
    return `\${[ ${name} ]}`;
  });
}

export function selected(value: unknown, key: string): unknown {
  if (!Array.isArray(value)) return value;
  const variants = rows(value);
  return (variants.find((v) => v.selected === true) ?? variants[0])?.[key];
}

export function variables(value: unknown): EnvironmentVariable[] {
  return rows(value).map((v) => {
    const raw = selected(v.value, "value");
    return {
      name: text(v.name),
      value: v.secret === true ? "" : template(typeof raw === "object" ? object(raw).data : raw),
      enabled: v.disabled !== true,
    };
  });
}

export function headers(value: unknown): HttpRequestHeader[] {
  return rows(value).map((h) => ({
    name: template(h.name),
    value: template(h.value),
    enabled: h.disabled !== true,
  }));
}

export function description(item: Obj, manual: Obj = {}): string {
  const info = object(item.info);
  const content = (v: unknown) => (typeof v === "string" ? v : text(object(v).content));
  const parts = [content(info.description), content(item.docs)].filter(Boolean);
  const retained = Object.fromEntries(Object.entries(manual).filter(([, v]) => v != null));
  if (Object.keys(retained).length) {
    // Keep unsupported executable features as inert text for manual migration.
    const yaml = YAML.stringify(retained).trimEnd();
    const fence = "`".repeat(Math.max(3, ...[...yaml.matchAll(/`+/g)].map((m) => m[0].length + 1)));
    parts.push(
      `Bruno source fields for manual review (scripts are not executed):\n\n${fence}yaml\n${yaml}\n${fence}`,
    );
  }
  return parts.join("\n\n");
}
