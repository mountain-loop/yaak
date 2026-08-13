/* oxlint-disable no-explicit-any */

export function isJSObject(obj: unknown) {
  return Object.prototype.toString.call(obj) === "[object Object]";
}

export function isJSString(obj: unknown) {
  return Object.prototype.toString.call(obj) === "[object String]";
}

export function convertId(id: string): string {
  if (id.startsWith("GENERATE_ID::")) {
    return id;
  }
  return `GENERATE_ID::${id}`;
}

export function importHttpBodyAndHeaders(obj: any) {
  const { headers } = importHeaders(obj);
  const { body, bodyType } = importHttpBody(obj.body);
  const mimeType = typeof obj.body?.mimeType === "string" ? obj.body.mimeType.trim() : "";

  if (
    bodyType != null &&
    mimeType !== "" &&
    !headers.some((header: { name: string }) => header.name.toLowerCase() === "content-type")
  ) {
    headers.push({ enabled: true, name: "Content-Type", value: mimeType });
  }

  return { body, bodyType, headers };
}

export function importHeaders(obj: any) {
  const headers = (obj.headers ?? [])
    .map((header: any) => ({
      enabled: !header.disabled,
      name: header.name ?? "",
      value: header.value ?? "",
    }))
    .filter(({ name, value }: any) => name !== "" || value !== "");
  return { headers } as const;
}

function importHttpBody(rawBody: any) {
  const mimeType = typeof rawBody?.mimeType === "string" ? rawBody.mimeType.trim() : "";
  const normalizedMimeType = mimeType.split(";", 1)[0]?.toLowerCase() ?? "";

  if (normalizedMimeType === "application/octet-stream") {
    return { bodyType: "binary", body: { filePath: rawBody.fileName ?? "" } };
  }

  if (normalizedMimeType === "application/x-www-form-urlencoded") {
    return {
      bodyType: "application/x-www-form-urlencoded",
      body: {
        form: (rawBody.params ?? []).map((parameter: any) => ({
          enabled: !parameter.disabled,
          name: parameter.name ?? "",
          value: parameter.value ?? "",
        })),
      },
    };
  }

  if (normalizedMimeType === "multipart/form-data") {
    return {
      bodyType: "multipart/form-data",
      body: {
        form: (rawBody.params ?? []).map((parameter: any) => ({
          enabled: !parameter.disabled,
          name: parameter.name ?? "",
          value: parameter.value ?? "",
          file: parameter.fileName ?? null,
        })),
      },
    };
  }

  if (normalizedMimeType === "application/graphql") {
    return { bodyType: "graphql", body: { text: rawBody.text ?? "" } };
  }

  if (normalizedMimeType === "application/json" || normalizedMimeType.endsWith("+json")) {
    return { bodyType: "application/json", body: { text: rawBody.text ?? "" } };
  }

  if (
    normalizedMimeType === "text/xml" ||
    normalizedMimeType === "application/xml" ||
    normalizedMimeType.endsWith("+xml")
  ) {
    return { bodyType: "text/xml", body: { text: rawBody.text ?? "" } };
  }

  if (typeof rawBody?.text === "string") {
    return { bodyType: "other", body: { text: rawBody.text } };
  }

  return { bodyType: null, body: {} };
}

export function deleteUndefinedAttrs<T>(obj: T): T {
  if (Array.isArray(obj) && obj != null) {
    return obj.map(deleteUndefinedAttrs) as T;
  }
  if (typeof obj === "object" && obj != null) {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, deleteUndefinedAttrs(v)]),
    ) as T;
  }
  return obj;
}

/** Recursively render all nested object properties */
export function convertTemplateSyntax<T>(obj: T): T {
  if (typeof obj === "string") {
    // oxlint-disable-next-line no-template-curly-in-string -- Yaak template syntax
    return obj.replaceAll(/{{\s*(_\.)?([^}]+)\s*}}/g, "${[$2]}") as T;
  }
  if (Array.isArray(obj) && obj != null) {
    return obj.map(convertTemplateSyntax) as T;
  }
  if (typeof obj === "object" && obj != null) {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, convertTemplateSyntax(v)]),
    ) as T;
  }
  return obj;
}
