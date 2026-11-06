import type { HttpRequest, HttpRequestHeader } from "@yaakapp/api";
import { headers, object, rows, selected, template, text } from "./common";

export function body(
  value: unknown,
  graphql: boolean,
  rawHeaders: unknown,
  inheritedHeaders: HttpRequestHeader[] = [],
): Pick<HttpRequest, "body" | "bodyType" | "headers"> {
  const b = object(selected(value, "body"));
  const requestHeaders = headers(rawHeaders);
  const result = (bodyType: string | null, data: Record<string, unknown>, contentType = "") => {
    if (
      contentType &&
      ![...inheritedHeaders, ...requestHeaders].some((h) => h.name.toLowerCase() === "content-type")
    ) {
      requestHeaders.push({ name: "Content-Type", value: contentType, enabled: true });
    }
    return { bodyType, body: data, headers: requestHeaders };
  };
  if (graphql) {
    return result(
      "graphql",
      {
        query: template(b.query),
        variables: template(
          typeof b.variables === "object" && b.variables != null
            ? JSON.stringify(b.variables, null, 2)
            : b.variables,
        ),
        ...(typeof b.operationName === "string"
          ? { operationName: template(b.operationName) }
          : {}),
      },
      "application/json",
    );
  }
  const types: Record<string, [string, string]> = {
    json: ["application/json", "application/json"],
    xml: ["application/xml", "application/xml"],
    text: ["other", "text/plain"],
    sparql: ["other", "application/sparql-query"],
  };
  const type = text(b.type);
  const rawType = Object.hasOwn(types, type) ? types[type] : undefined;
  if (rawType) return result(rawType[0], { text: template(b.data) }, rawType[1]);
  if (type === "form-urlencoded")
    return result(
      "application/x-www-form-urlencoded",
      { form: headers(b.data) },
      "application/x-www-form-urlencoded",
    );
  if (type === "multipart-form") {
    const form = rows(b.data).flatMap<Record<string, unknown>>((v) => {
      const base = {
        name: template(v.name),
        enabled: v.disabled !== true,
        ...(v.contentType ? { contentType: template(v.contentType) } : {}),
      };
      return v.type === "file"
        ? (Array.isArray(v.value) ? v.value : [v.value]).map((file: unknown) => ({
            ...base,
            file: template(file),
          }))
        : [{ ...base, value: template(v.value) }];
    });
    return result("multipart/form-data", { form }, "multipart/form-data");
  }
  if (type === "file") {
    const file = rows(b.data).find((v) => v.selected === true);
    return file
      ? result("binary", { filePath: template(file.filePath) }, text(file.contentType))
      : result(null, {});
  }
  return result(null, {});
}

export function urlAndParams(url: unknown, value: unknown) {
  const params = rows(value);
  const urlParameters = params.map((p) => ({
    name: `${p.type === "path" ? ":" : ""}${template(p.name)}`,
    value: template(p.value),
    enabled: p.disabled !== true,
  }));
  // Bruno stores query parameters in both the URL and the editor rows. Yaak appends rows.
  const names = new Set(params.filter((p) => p.type !== "path").map((p) => text(p.name)));
  const raw = text(url);
  const hash = raw.indexOf("#");
  const fragment = hash < 0 ? "" : raw.slice(hash);
  const base = hash < 0 ? raw : raw.slice(0, hash);
  const q = base.indexOf("?");
  if (q < 0 || names.size === 0) return { url: template(raw), urlParameters };
  const query = base
    .slice(q + 1)
    .split("&")
    .filter((pair) => {
      const key = pair.split("=")[0] ?? "";
      try {
        return !names.has(decodeURIComponent(key.replaceAll("+", " ")));
      } catch {
        return !names.has(key);
      }
    })
    .join("&");
  return {
    url: template(`${base.slice(0, q)}${query ? `?${query}` : ""}${fragment}`),
    urlParameters,
  };
}
