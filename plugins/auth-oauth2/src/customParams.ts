import type { JsonPrimitive } from "@yaakapp/api";

export interface NameValue {
  name: string;
  value: string;
}

/** Custom entries for a single outgoing request */
export interface CustomRequestParams {
  headers: NameValue[];
  body: NameValue[];
}

export interface CustomParams {
  /** Query parameters appended to the authorization URL */
  authorizationQuery: NameValue[];
  token: CustomRequestParams;
  /** Already merged over `token`, so the refresh request only reads this */
  refresh: CustomRequestParams;
}

export const NO_CUSTOM_PARAMS: CustomParams = {
  authorizationQuery: [],
  token: { headers: [], body: [] },
  refresh: { headers: [], body: [] },
};

/**
 * A key_value form input stores its rows as a JSON-encoded array of pairs. The
 * whole string goes through the template engine before it reaches the plugin,
 * so a row's value can be a template.
 */
export function parsePairs(value: JsonPrimitive | undefined): NameValue[] {
  if (value == null || value === "") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value));
  } catch {
    console.log("[oauth2] Ignoring custom parameters that failed to parse");
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const pairs: NameValue[] = [];
  for (const row of parsed) {
    if (row == null || typeof row !== "object") continue;
    const { name, value, enabled } = row as { name?: unknown; value?: unknown; enabled?: unknown };
    if (enabled === false) continue;
    const trimmedName = typeof name === "string" ? name.trim() : "";
    if (trimmedName === "") continue;
    pairs.push({ name: trimmedName, value: rowValue(value) });
  }

  return pairs;
}

/** The pair editor writes strings, but a hand-edited file may hold any primitive */
function rowValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/**
 * Read every custom parameter list off the auth form.
 *
 * Token entries also apply to the refresh request, so the refresh lists are the
 * token lists with the refresh-specific rows merged over them.
 */
export function readCustomParams(values: Record<string, JsonPrimitive | undefined>): CustomParams {
  const tokenHeaders = parsePairs(values.tokenHeaders);
  const tokenBody = parsePairs(values.tokenBodyParams);

  return {
    authorizationQuery: parsePairs(values.authorizationParams),
    token: { headers: tokenHeaders, body: tokenBody },
    refresh: {
      headers: mergeHeaders(tokenHeaders, parsePairs(values.refreshHeaders)),
      body: mergeFormParams(tokenBody, parsePairs(values.refreshBodyParams)),
    },
  };
}

/**
 * Custom entries win over generated ones of the same name: every generated
 * entry the custom list names is dropped, then the custom list is appended.
 * Dropping by name rather than replacing in place means two custom rows sharing
 * a name both survive, which repeatable headers and params rely on.
 */
function mergeByName<T extends NameValue>(
  generated: T[],
  custom: NameValue[],
  { caseInsensitive }: { caseInsensitive: boolean },
): (T | NameValue)[] {
  if (custom.length === 0) return generated;

  const normalize = (name: string) => (caseInsensitive ? name.toLowerCase() : name);
  const overridden = new Set(custom.map((c) => normalize(c.name)));

  return [...generated.filter((g) => !overridden.has(normalize(g.name))), ...custom];
}

export function mergeHeaders<T extends NameValue>(generated: T[], custom: NameValue[]) {
  return mergeByName(generated, custom, { caseInsensitive: true });
}

export function mergeFormParams<T extends NameValue>(generated: T[], custom: NameValue[]) {
  return mergeByName(generated, custom, { caseInsensitive: false });
}

/** Apply custom query parameters to an authorization URL, in place */
export function applyQueryParams(url: URL, custom: NameValue[]) {
  for (const name of new Set(custom.map((c) => c.name))) {
    url.searchParams.delete(name);
  }
  for (const { name, value } of custom) {
    url.searchParams.append(name, value);
  }
}
