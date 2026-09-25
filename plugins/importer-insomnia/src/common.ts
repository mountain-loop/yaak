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
      // A raw GraphQL document is also valid; preserve it verbatim. An envelope that
      // failed to parse is usually one with template tags in it, so recover its parts
      // rather than dropping the whole envelope into the query editor.
      const recovered = recoverGraphQLEnvelope(text);
      if (recovered != null) {
        return { bodyType: "graphql", body: recovered };
      }
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

/**
 * Pull the parts out of a GraphQL envelope that isn't valid JSON.
 *
 * Insomnia lets template tags be written straight into the envelope
 * ({"query":"{me{id}}","variables":{"id":{{ _.id }}}}), which makes the text
 * unparseable. Members are read as raw text so the tags survive the trip.
 */
function recoverGraphQLEnvelope(
  text: string,
): { query: string; variables: string; operationName?: string } | null {
  const members = readTopLevelMembers(text);
  if (members == null) return null;

  const query = parseJSONString(members.get("query"));
  if (query == null) return null;

  const variables = members.get("variables") ?? "";
  const operationName = parseJSONString(members.get("operationName"));
  return {
    query,
    variables: variables === "null" ? "" : variables,
    ...(operationName == null ? {} : { operationName }),
  };
}

function parseJSONString(raw: string | undefined): string | null {
  if (raw == null || !raw.startsWith('"')) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The raw text of each member of the outermost object, without parsing the values.
 * Returns null unless the whole object is well-formed enough to walk.
 */
function readTopLevelMembers(text: string): Map<string, string> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;

  const members = new Map<string, string>();
  let offset = 1;
  while (offset < trimmed.length) {
    while (/[\s,]/.test(trimmed[offset] ?? "")) offset++;
    if (trimmed[offset] === "}") return members;

    const keyEnd = scanJSONString(trimmed, offset);
    if (keyEnd == null) return null;
    const key = parseJSONString(trimmed.slice(offset, keyEnd));
    if (key == null) return null;

    offset = keyEnd;
    while (/\s/.test(trimmed[offset] ?? "")) offset++;
    if (trimmed[offset] !== ":") return null;
    offset++;
    while (/\s/.test(trimmed[offset] ?? "")) offset++;

    const valueEnd = scanJSONValue(trimmed, offset);
    if (valueEnd == null) return null;
    members.set(key, trimmed.slice(offset, valueEnd).trim());
    offset = valueEnd;
  }
  return null;
}

/** Offset just past the string starting at `start`, or null if it never closes. */
function scanJSONString(text: string, start: number): number | null {
  if (text[start] !== '"') return null;
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"') return i + 1;
  }
  return null;
}

/**
 * Offset just past the value starting at `start`. Nesting is tracked so template
 * tags come back whole, but the value itself is not validated.
 */
function scanJSONValue(text: string, start: number): number | null {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"') {
      const end = scanJSONString(text, i);
      if (end == null) return null;
      i = end - 1;
    } else if (char === "{" || char === "[") {
      depth++;
    } else if (char === "}" || char === "]") {
      if (depth === 0) return i; // The member ended with the enclosing object
      depth--;
      if (depth === 0) return i + 1;
    } else if (depth === 0 && char === ",") {
      return i;
    }
  }
  return null;
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
