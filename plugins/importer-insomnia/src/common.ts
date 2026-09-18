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

export function createSourceKeys() {
  const keys: Record<string, string> = {};
  return {
    /** Convert a resource's own document ID, keeping it as that resource's source key. */
    own(id: string): string {
      const converted = convertId(id);
      keys[converted] = id;
      return converted;
    },
    all: (): Record<string, string> => keys,
  };
}

export type SourceKeys = ReturnType<typeof createSourceKeys>;

export function importHttpBodyAndHeaders(obj: any) {
  const { headers } = importHeaders(obj);
  const { body, bodyType } = importHttpBody(obj.body);
  const mimeType = typeof obj.body?.mimeType === "string" ? obj.body.mimeType.trim() : "";
  // Insomnia uses application/graphql as an editor marker, but sends a JSON envelope.
  const contentType = bodyType === "graphql" ? "application/json" : mimeType;

  if (
    bodyType != null &&
    mimeType !== "" &&
    !headers.some((header: { name: string }) => header.name.toLowerCase() === "content-type")
  ) {
    headers.push({ enabled: true, name: "Content-Type", value: contentType });
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
    const text = typeof rawBody.text === "string" ? rawBody.text : "";
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed?.query === "string") {
        return {
          bodyType: "graphql",
          body: {
            query: parsed.query,
            variables:
              typeof parsed.variables === "string"
                ? parsed.variables
                : parsed.variables == null
                  ? ""
                  : JSON.stringify(parsed.variables, null, 2),
            ...(typeof parsed.operationName === "string"
              ? { operationName: parsed.operationName }
              : {}),
          },
        };
      }
    } catch {
      // A raw GraphQL document is also valid; preserve it verbatim.
    }
    return { bodyType: "graphql", body: { query: text, variables: "" } };
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
