import type { HttpRequest } from "@yaakapp-internal/models";
import {
  BODY_TYPE_BINARY,
  BODY_TYPE_FORM_MULTIPART,
  BODY_TYPE_FORM_URLENCODED,
  BODY_TYPE_GRAPHQL,
  BODY_TYPE_JSON,
  BODY_TYPE_NONE,
} from "./model_util";

type Body = HttpRequest["body"];
type BodyType = HttpRequest["bodyType"];
type GraphQLBody = {
  query: string;
  variables: string | undefined;
  operationName?: string;
};

export function convertRequestBody({
  body,
  fromBodyType,
  toBodyType,
}: {
  body: Body;
  fromBodyType: BodyType;
  toBodyType: BodyType;
}): Body {
  if (toBodyType === BODY_TYPE_NONE) {
    return {};
  }

  if (toBodyType === BODY_TYPE_GRAPHQL) {
    return toGraphQLBody(body) ?? body;
  }

  if (toBodyType === BODY_TYPE_FORM_URLENCODED || toBodyType === BODY_TYPE_FORM_MULTIPART) {
    return toFormBody(body) ?? body;
  }

  if (toBodyType === BODY_TYPE_BINARY) {
    return typeof body.filePath === "string" ? { filePath: body.filePath } : body;
  }

  return toTextBody(body, fromBodyType, toBodyType) ?? body;
}

export function normalizeGraphQLBody(body: Body): GraphQLBody {
  return toGraphQLBody(body) ?? { query: "", variables: undefined };
}

function toGraphQLBody(body: Body): GraphQLBody | null {
  if (typeof body.query === "string") {
    const result: GraphQLBody = {
      query: body.query,
      variables: typeof body.variables === "string" ? body.variables : undefined,
    };
    if (typeof body.operationName === "string") {
      result.operationName = body.operationName;
    }

    return result;
  }

  if (typeof body.text === "string") {
    try {
      const parsed: unknown = JSON.parse(body.text);
      if (!isRecord(parsed)) {
        return null;
      }

      if (typeof parsed.query !== "string") {
        return null;
      }

      const query = parsed.query;
      const variables =
        parsed.variables == null ? undefined : JSON.stringify(parsed.variables, null, 2);

      const result: GraphQLBody = { query, variables };
      if (typeof parsed.operationName === "string") {
        result.operationName = parsed.operationName;
      }

      return result;
    } catch {
      return { query: body.text, variables: undefined };
    }
  }

  return null;
}

function toFormBody(body: Body): Body | null {
  if (Array.isArray(body.form)) {
    return {
      form: body.form.map((p) => ({
        enabled: p.enabled !== false,
        name: typeof p.name === "string" ? p.name : "",
        value: stringifyFormValue(p.value ?? p.file),
        contentType: typeof p.contentType === "string" ? p.contentType : undefined,
        filename: typeof p.filename === "string" ? p.filename : undefined,
        file: typeof p.file === "string" ? p.file : undefined,
        id: typeof p.id === "string" ? p.id : undefined,
      })),
    };
  }

  return null;
}

function toTextBody(body: Body, fromBodyType: BodyType, toBodyType: BodyType): Body | null {
  const sendJsonComments =
    typeof body.sendJsonComments === "boolean" ? { sendJsonComments: body.sendJsonComments } : {};

  if (typeof body.text === "string") {
    return { text: body.text, ...sendJsonComments };
  }

  if (Array.isArray(body.form)) {
    if (toBodyType === BODY_TYPE_JSON) {
      return { text: JSON.stringify(formBodyToObject(body.form), null, 2) };
    }

    return { text: formBodyToUrlEncodedText(body.form) };
  }

  if (typeof body.query === "string") {
    if (toBodyType === BODY_TYPE_JSON || fromBodyType === BODY_TYPE_GRAPHQL) {
      const value: Record<string, unknown> = { query: body.query };
      if (typeof body.variables === "string" && body.variables.trim() !== "") {
        value.variables = parseJson(body.variables) ?? body.variables;
      }
      if (typeof body.operationName === "string" && body.operationName.trim() !== "") {
        value.operationName = body.operationName;
      }

      return { text: JSON.stringify(value, null, 2) };
    }

    return { text: body.query };
  }

  if (typeof body.filePath === "string") {
    return { text: body.filePath };
  }

  return null;
}

function formBodyToUrlEncodedText(form: unknown[]): string {
  const params = new URLSearchParams();

  for (const pair of form) {
    if (!isRecord(pair)) continue;
    if (pair.enabled === false) continue;
    if (typeof pair.name !== "string" || pair.name === "") continue;
    params.append(pair.name, stringifyFormValue(pair.value));
  }

  return params.toString();
}

function formBodyToObject(form: unknown[]) {
  const result: Record<string, unknown> = {};

  for (const pair of form) {
    if (!isRecord(pair)) continue;
    if (pair.enabled === false) continue;
    if (typeof pair.name !== "string" || pair.name === "") continue;

    const value = stringifyFormValue(pair.value);
    if (pair.name in result) {
      const existing = result[pair.name];
      result[pair.name] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      result[pair.name] = value;
    }
  }

  return result;
}

function stringifyFormValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function parseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
