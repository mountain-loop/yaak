import type {
  Context,
  Environment,
  Folder,
  HttpRequest,
  HttpRequestHeader,
  HttpUrlParameter,
  PartialImportResources,
  PluginDefinition,
  Workspace,
} from "@yaakapp/api";
import type { ImportPluginResponse } from "@yaakapp/api/lib/plugins/ImporterPlugin";
import YAML from "yaml";

type AtLeast<T, K extends keyof T> = Partial<T> & Pick<T, K>;
type UnknownRecord = Record<string, unknown>;
type ImportResources = {
  workspaces: AtLeast<Workspace, "name" | "id" | "model">[];
  environments: AtLeast<Environment, "name" | "id" | "model" | "workspaceId" | "variables">[];
  folders: AtLeast<Folder, "name" | "id" | "model" | "workspaceId">[];
  httpRequests: AtLeast<HttpRequest, "name" | "id" | "model" | "workspaceId">[];
};

const HTTP_METHODS = ["delete", "get", "head", "options", "patch", "post", "put", "trace"];
const BODY_CONTENT_TYPE_PREFERENCE = [
  "application/json",
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "application/xml",
  "text/plain",
];
const MAX_EXAMPLE_DEPTH = 8;
const MAX_EXAMPLE_PROPERTIES = 25;
const MAX_DESCRIPTION_ITEMS = 40;

export const plugin: PluginDefinition = {
  importer: {
    name: "OpenAPI",
    description: "Import OpenAPI collections",
    onImport(_ctx: Context, args: { text: string }) {
      return convertOpenApi(args.text);
    },
  },
};

export async function convertOpenApi(contents: string): Promise<ImportPluginResponse | undefined> {
  const spec = parseSpec(contents);
  if (!isOpenApiSpec(spec)) return undefined;

  const importState = new ImportState(spec);
  const workspace: ImportResources["workspaces"][0] = {
    model: "workspace",
    id: importState.generateId("workspace"),
    name: stringAt(spec.info, "title") ?? "OpenAPI Import",
    description: importInfoDescription(toRecord(spec.info)),
  };

  const resources: ImportResources = {
    workspaces: [workspace],
    environments: [],
    folders: [],
    httpRequests: [],
  };
  const baseUrl = importBaseUrl(spec);
  const requestBaseUrl = baseUrl.length > 0 ? "${[baseUrl]}" : "";

  if (baseUrl.length > 0) {
    resources.environments.push({
      model: "environment",
      id: importState.generateId("environment"),
      workspaceId: workspace.id,
      name: "Global Variables",
      variables: [{ name: "baseUrl", value: baseUrl }],
      parentModel: "workspace",
      parentId: null,
      sortPriority: importState.nextSortPriority(),
    });
  }

  const folderIdsByTag = new Map<string, string>();
  for (const tag of toArray(spec.tags)) {
    const tagRecord = toRecord(tag);
    const name = stringAt(tagRecord, "name");
    if (name == null || folderIdsByTag.has(name)) continue;

    const folder: ImportResources["folders"][0] = {
      model: "folder",
      id: importState.generateId("folder"),
      workspaceId: workspace.id,
      name,
      description: importTagDescription(tagRecord),
      folderId: null,
      sortPriority: importState.nextSortPriority(),
    };
    resources.folders.push(folder);
    folderIdsByTag.set(name, folder.id);
  }

  for (const [rawPath, rawPathItem] of Object.entries(toRecord(spec.paths))) {
    const pathItem = importState.resolve(rawPathItem);
    if (!isRecord(pathItem)) continue;

    const pathParameters = toArray(pathItem.parameters);
    for (const method of HTTP_METHODS) {
      const operation = importState.resolve(pathItem[method]);
      if (!isRecord(operation)) continue;

      const folderId = findOrCreateFolderId({
        folderIdsByTag,
        importState,
        operation,
        resources,
        workspaceId: workspace.id,
      });

      resources.httpRequests.push(
        importOperation({
          importState,
          method,
          operation,
          path: rawPath,
          pathParameters,
          requestBaseUrl,
          spec,
          workspaceId: workspace.id,
          folderId,
        }),
      );
    }
  }

  if (resources.httpRequests.length === 0) return undefined;

  return {
    resources: deleteUndefinedAttrs(
      convertTemplateSyntax({
        environments: resources.environments,
        folders: resources.folders,
        grpcRequests: [],
        httpRequests: resources.httpRequests,
        websocketRequests: [],
        workspaces: resources.workspaces,
      }),
    ) as PartialImportResources,
  };
}

function importOperation({
  importState,
  method,
  operation,
  path,
  pathParameters,
  requestBaseUrl,
  spec,
  workspaceId,
  folderId,
}: {
  importState: ImportState;
  method: string;
  operation: UnknownRecord;
  path: string;
  pathParameters: unknown[];
  requestBaseUrl: string;
  spec: UnknownRecord;
  workspaceId: string;
  folderId: string | null;
}): ImportResources["httpRequests"][0] {
  const parameters = [...pathParameters, ...toArray(operation.parameters)].map((p) =>
    importState.resolve(p),
  );
  const body = importBody({ importState, operation, parameters, spec });
  const urlParameters = importUrlParameters({ importState, parameters });
  const headers = mergeHeaders(importHeaderParameters({ importState, parameters }), body.headers);

  return {
    model: "http_request",
    id: importState.generateId("http_request"),
    workspaceId,
    folderId,
    name: importOperationName(operation, method, path),
    description: importOperationDescription({
      importState,
      operation,
      parameters,
      bodyContentType: body.bodyType,
    }),
    method: method.toUpperCase(),
    url: buildOperationUrl(requestBaseUrl, path),
    urlParameters,
    headers,
    body: body.body,
    bodyType: body.bodyType,
    sortPriority: importState.nextSortPriority(),
    ...importAuthentication({ importState, operation, spec }),
  };
}

function parseSpec(contents: string): unknown {
  try {
    return JSON.parse(contents);
  } catch {
    // Fall through to YAML.
  }

  try {
    return YAML.parse(contents);
  } catch {
    return null;
  }
}

function isOpenApiSpec(value: unknown): value is UnknownRecord {
  const spec = toRecord(value);
  const openapi = stringAt(spec, "openapi");
  const swagger = stringAt(spec, "swagger");
  return isRecord(spec.paths) && (openapi?.startsWith("3.") === true || swagger === "2.0");
}

function importInfoDescription(info: UnknownRecord): string | undefined {
  const parts = [
    stringAt(info, "description"),
    stringAt(info, "termsOfService")
      ? `Terms of service: ${stringAt(info, "termsOfService")}`
      : null,
    isRecord(info.contact) && stringAt(info.contact, "email")
      ? `Contact: ${stringAt(info.contact, "email")}`
      : null,
    isRecord(info.license) && stringAt(info.license, "name")
      ? `License: ${stringAt(info.license, "name")}${
          stringAt(info.license, "url") ? ` (${stringAt(info.license, "url")})` : ""
        }`
      : null,
  ].filter(isPresent);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function importTagDescription(tag: UnknownRecord): string | undefined {
  const externalDocs = toRecord(tag.externalDocs);
  const parts = [
    stringAt(tag, "description"),
    stringAt(externalDocs, "url")
      ? `${stringAt(externalDocs, "description") ?? "External docs"}: ${stringAt(externalDocs, "url")}`
      : null,
  ].filter(isPresent);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function importOperationName(operation: UnknownRecord, method: string, path: string): string {
  return (
    stringAt(operation, "summary") ??
    stringAt(operation, "operationId") ??
    `${method.toUpperCase()} ${path}`
  );
}

function importOperationDescription({
  importState,
  operation,
  parameters,
  bodyContentType,
}: {
  importState: ImportState;
  operation: UnknownRecord;
  parameters: unknown[];
  bodyContentType: string | null;
}): string | undefined {
  const parts: string[] = [];
  const summary = stringAt(operation, "summary");
  const description = stringAt(operation, "description");
  const operationId = stringAt(operation, "operationId");

  if (description != null) {
    parts.push(description);
  } else if (summary != null) {
    parts.push(summary);
  }

  if (operationId != null) {
    parts.push(`Operation ID: ${operationId}`);
  }

  const parameterDescriptions = parameters
    .map((p) => importState.resolve(p))
    .filter(isRecord)
    .slice(0, MAX_DESCRIPTION_ITEMS)
    .map((p) => {
      const name = stringAt(p, "name") ?? "parameter";
      const location = stringAt(p, "in") ?? "unknown";
      const required = p.required === true ? ", required" : "";
      const description = stringAt(p, "description");
      return `- ${name} (${location}${required})${description ? `: ${description}` : ""}`;
    });
  if (parameterDescriptions.length > 0) {
    parts.push(["Parameters:", ...parameterDescriptions].join("\n"));
  }

  const requestBody = importState.resolve(operation.requestBody);
  if (isRecord(requestBody)) {
    const content = toRecord(requestBody.content);
    const contentTypes = Object.keys(content);
    const bodyLines = [
      stringAt(requestBody, "description"),
      bodyContentType ? `Selected content type: ${bodyContentType}` : null,
      contentTypes.length > 0 ? `Available content types: ${contentTypes.join(", ")}` : null,
    ].filter(isPresent);
    if (bodyLines.length > 0) {
      parts.push(["Request body:", ...bodyLines].join("\n"));
    }
  }

  const responseDescriptions = Object.entries(toRecord(operation.responses))
    .slice(0, MAX_DESCRIPTION_ITEMS)
    .map(([status, response]) => {
      const responseRecord = toRecord(importState.resolve(response));
      return `- ${status}: ${stringAt(responseRecord, "description") ?? ""}`.trimEnd();
    });
  if (responseDescriptions.length > 0) {
    parts.push(["Responses:", ...responseDescriptions].join("\n"));
  }

  const externalDocs = toRecord(operation.externalDocs);
  if (stringAt(externalDocs, "url")) {
    parts.push(
      `${stringAt(externalDocs, "description") ?? "External docs"}: ${stringAt(externalDocs, "url")}`,
    );
  }

  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function findOrCreateFolderId({
  folderIdsByTag,
  importState,
  operation,
  resources,
  workspaceId,
}: {
  folderIdsByTag: Map<string, string>;
  importState: ImportState;
  operation: UnknownRecord;
  resources: ImportResources;
  workspaceId: string;
}): string | null {
  const tag = toArray(operation.tags).find((t): t is string => typeof t === "string");
  if (tag == null) return null;

  const existingFolderId = folderIdsByTag.get(tag);
  if (existingFolderId != null) return existingFolderId;

  const folder: ImportResources["folders"][0] = {
    model: "folder",
    id: importState.generateId("folder"),
    workspaceId,
    name: tag,
    folderId: null,
    sortPriority: importState.nextSortPriority(),
  };
  resources.folders.push(folder);
  folderIdsByTag.set(tag, folder.id);
  return folder.id;
}

function buildOperationUrl(baseUrl: string, path: string): string {
  return joinUrlParts(baseUrl, path.replaceAll(/{([^}/]+)}/g, ":$1"));
}

function importBaseUrl(spec: UnknownRecord): string {
  const openApiServer = toArray(spec.servers)
    .map((s) => toRecord(s))
    .map((s) => interpolateServerUrl(s))
    .find((url) => url.length > 0);
  if (openApiServer != null) return openApiServer;

  const host = stringAt(spec, "host");
  if (host == null) return stringAt(spec, "basePath") ?? "";

  const scheme = toArray(spec.schemes).find((s): s is string => typeof s === "string") ?? "https";
  return joinUrlParts(`${scheme}://${host}`, stringAt(spec, "basePath") ?? "");
}

function interpolateServerUrl(server: UnknownRecord): string {
  let url = stringAt(server, "url") ?? "";
  for (const [name, variable] of Object.entries(toRecord(server.variables))) {
    url = url.replaceAll(`{${name}}`, stringifyExampleValue(toRecord(variable).default));
  }
  return url;
}

function joinUrlParts(baseUrl: string, path: string): string {
  if (baseUrl.length === 0) return path;
  return `${trimTrailingSlashes(baseUrl)}/${trimLeadingSlashes(path)}`;
}

function trimLeadingSlashes(value: string): string {
  let index = 0;
  while (value[index] === "/") index++;
  return value.slice(index);
}

function trimTrailingSlashes(value: string): string {
  let index = value.length;
  while (value[index - 1] === "/") index--;
  return value.slice(0, index);
}

function importUrlParameters({
  importState,
  parameters,
}: {
  importState: ImportState;
  parameters: unknown[];
}): HttpUrlParameter[] {
  return parameters
    .map((p) => importState.resolve(p))
    .filter(isRecord)
    .filter((p) => stringAt(p, "in") === "query" || stringAt(p, "in") === "path")
    .map((p) => ({
      enabled: p.required === true,
      name:
        stringAt(p, "in") === "path"
          ? `:${stringAt(p, "name") ?? ""}`
          : (stringAt(p, "name") ?? ""),
      value: parameterExample(p, importState),
    }))
    .filter(({ name }) => name.length > 0);
}

function importHeaderParameters({
  importState,
  parameters,
}: {
  importState: ImportState;
  parameters: unknown[];
}): HttpRequestHeader[] {
  return parameters
    .map((p) => importState.resolve(p))
    .filter(isRecord)
    .filter((p) => stringAt(p, "in") === "header")
    .map((p) => ({
      enabled: p.required === true,
      name: stringAt(p, "name") ?? "",
      value: parameterExample(p, importState),
    }))
    .filter(({ name }) => name.length > 0);
}

function parameterExample(parameter: UnknownRecord, importState: ImportState): string {
  const directExample = firstPresent(parameter.example, firstExampleValue(parameter.examples));
  if (directExample != null) return stringifyExampleValue(directExample);
  return stringifyExampleValue(schemaToExample(importState.resolve(parameter.schema), importState));
}

function importBody({
  importState,
  operation,
  parameters,
  spec,
}: {
  importState: ImportState;
  operation: UnknownRecord;
  parameters: unknown[];
  spec: UnknownRecord;
}): {
  headers: HttpRequestHeader[];
  body: Record<string, unknown>;
  bodyType: string | null;
} {
  const openApiRequestBody = importState.resolve(operation.requestBody);
  if (isRecord(openApiRequestBody)) {
    return importBodyFromContent(importState, toRecord(openApiRequestBody.content));
  }

  const bodyParameter = parameters
    .map((p) => importState.resolve(p))
    .find((p) => isRecord(p) && stringAt(p, "in") === "body");
  if (isRecord(bodyParameter)) {
    const contentType = toArray(spec.consumes).find((c): c is string => typeof c === "string");
    const bodyType = contentType ?? "application/json";
    return {
      headers: [{ enabled: true, name: "Content-Type", value: bodyType }],
      bodyType,
      body: {
        text: formatBodyText(
          schemaToExample(importState.resolve(bodyParameter.schema), importState),
        ),
      },
    };
  }

  const formParameters = parameters
    .map((p) => importState.resolve(p))
    .filter(isRecord)
    .filter((p) => stringAt(p, "in") === "formData");
  if (formParameters.length > 0) {
    const contentType =
      toArray(spec.consumes).find((c): c is string => typeof c === "string") ??
      (formParameters.some((p) => stringAt(p, "type") === "file")
        ? "multipart/form-data"
        : "application/x-www-form-urlencoded");
    return {
      headers: [{ enabled: true, name: "Content-Type", value: contentType }],
      bodyType: contentType,
      body: {
        form: formParameters.map((p) => ({
          enabled: p.required === true,
          name: stringAt(p, "name") ?? "",
          value: parameterExample(p, importState),
        })),
      },
    };
  }

  return { headers: [], body: {}, bodyType: null };
}

function importBodyFromContent(importState: ImportState, content: UnknownRecord) {
  const contentType = chooseContentType(Object.keys(content));
  if (contentType == null) return { headers: [], body: {}, bodyType: null };

  const mediaType = toRecord(content[contentType]);
  const example = mediaTypeExample(mediaType, importState);

  if (
    contentType === "application/x-www-form-urlencoded" ||
    contentType === "multipart/form-data"
  ) {
    return {
      headers: [{ enabled: true, name: "Content-Type", value: contentType }],
      bodyType: contentType,
      body: {
        form: schemaToFormParameters(importState.resolve(mediaType.schema), importState),
      },
    };
  }

  return {
    headers: [{ enabled: true, name: "Content-Type", value: contentType }],
    bodyType: contentType === "application/octet-stream" ? "binary" : contentType,
    body: contentType === "application/octet-stream" ? {} : { text: formatBodyText(example) },
  };
}

function chooseContentType(contentTypes: string[]): string | null {
  for (const preference of BODY_CONTENT_TYPE_PREFERENCE) {
    const exact = contentTypes.find((c) => c.toLowerCase() === preference);
    if (exact != null) return exact;
  }
  return contentTypes[0] ?? null;
}

function mediaTypeExample(mediaType: UnknownRecord, importState: ImportState): unknown {
  const directExample = firstPresent(mediaType.example, firstExampleValue(mediaType.examples));
  if (directExample != null) return directExample;
  return schemaToExample(importState.resolve(mediaType.schema), importState);
}

function schemaToFormParameters(schema: unknown, importState: ImportState) {
  const resolvedSchema = toRecord(importState.resolve(schema));
  const required = toArray(resolvedSchema.required).filter(
    (name): name is string => typeof name === "string",
  );
  const properties = Object.entries(toRecord(resolvedSchema.properties)).slice(
    0,
    MAX_EXAMPLE_PROPERTIES,
  );

  return properties.map(([name, property]) => {
    const resolvedProperty = toRecord(importState.resolve(property));
    const example = schemaToExample(resolvedProperty, importState);
    const base = {
      enabled: required.includes(name),
      name,
    };
    if (stringAt(resolvedProperty, "format") === "binary") {
      return { ...base, file: "" };
    }
    return { ...base, value: stringifyExampleValue(example) };
  });
}

function schemaToExample(
  schema: unknown,
  importState: ImportState,
  depth = 0,
  visitedRefs = new Set<string>(),
): unknown {
  if (depth > MAX_EXAMPLE_DEPTH) return {};

  const resolved = importState.resolve(schema, visitedRefs);
  if (!isRecord(resolved)) return "";

  const explicitExample = firstPresent(
    resolved.example,
    firstExampleValue(resolved.examples),
    resolved.default,
  );
  if (explicitExample != null) return explicitExample;

  const enumValues = toArray(resolved.enum);
  if (enumValues.length > 0) return enumValues[0];

  const allOf = toArray(resolved.allOf);
  if (allOf.length > 0) {
    return allOf.reduce<UnknownRecord>((merged, childSchema) => {
      const childExample = schemaToExample(childSchema, importState, depth + 1, visitedRefs);
      return isRecord(childExample) ? { ...merged, ...childExample } : merged;
    }, {});
  }

  const oneOf = toArray(resolved.oneOf);
  const anyOf = toArray(resolved.anyOf);
  if (oneOf.length > 0 || anyOf.length > 0) {
    return schemaToExample(oneOf[0] ?? anyOf[0], importState, depth + 1, visitedRefs);
  }

  const type = inferSchemaType(resolved);
  if (type === "array") {
    return [schemaToExample(resolved.items, importState, depth + 1, visitedRefs)];
  }
  if (type === "object") {
    const required = toArray(resolved.required).filter(
      (name): name is string => typeof name === "string",
    );
    const properties = Object.entries(toRecord(resolved.properties)).sort(([a], [b]) => {
      const aRequired = required.includes(a);
      const bRequired = required.includes(b);
      return aRequired === bRequired ? 0 : aRequired ? -1 : 1;
    });

    return Object.fromEntries(
      properties
        .slice(0, MAX_EXAMPLE_PROPERTIES)
        .map(([name, property]) => [
          name,
          schemaToExample(property, importState, depth + 1, visitedRefs),
        ]),
    );
  }
  if (type === "integer" || type === "number") return 0;
  if (type === "boolean") return false;
  if (stringAt(resolved, "format") === "date-time") return "2026-01-01T00:00:00Z";
  if (stringAt(resolved, "format") === "date") return "2026-01-01";
  return "";
}

function inferSchemaType(schema: UnknownRecord): string {
  const rawType = schema.type;
  if (typeof rawType === "string") return rawType;
  if (Array.isArray(rawType)) {
    const nonNullType = rawType.find((t) => t !== "null");
    if (typeof nonNullType === "string") return nonNullType;
  }
  if (isRecord(schema.properties) || isRecord(schema.additionalProperties)) return "object";
  if (schema.items != null) return "array";
  return "string";
}

function importAuthentication({
  importState,
  operation,
  spec,
}: {
  importState: ImportState;
  operation: UnknownRecord;
  spec: UnknownRecord;
}): Pick<HttpRequest, "authentication" | "authenticationType"> {
  const security = operation.security ?? spec.security;
  if (!Array.isArray(security) || security.length === 0) {
    return { authenticationType: null, authentication: {} };
  }

  const schemes = {
    ...toRecord(toRecord(spec.components).securitySchemes),
    ...toRecord(spec.securityDefinitions),
  };
  for (const requirement of security) {
    for (const schemeName of Object.keys(toRecord(requirement))) {
      const scheme = toRecord(importState.resolve(schemes[schemeName]));
      const type = stringAt(scheme, "type");
      if (type === "apiKey") {
        return {
          authenticationType: "apikey",
          authentication: {
            location: stringAt(scheme, "in") === "query" ? "query" : "header",
            key: stringAt(scheme, "name") ?? schemeName,
            value: "",
          },
        };
      }
      if (type === "http" && stringAt(scheme, "scheme")?.toLowerCase() === "basic") {
        return {
          authenticationType: "basic",
          authentication: { username: "", password: "" },
        };
      }
      if (type === "http" && stringAt(scheme, "scheme")?.toLowerCase() === "bearer") {
        return {
          authenticationType: "bearer",
          authentication: { token: "", prefix: "Bearer" },
        };
      }
    }
  }

  return { authenticationType: null, authentication: {} };
}

function mergeHeaders(...headerGroups: HttpRequestHeader[][]): HttpRequestHeader[] {
  const headers: HttpRequestHeader[] = [];
  for (const header of headerGroups.flat()) {
    const existing = headers.find((h) => h.name.toLowerCase() === header.name.toLowerCase());
    if (existing == null) {
      headers.push(header);
    }
  }
  return headers;
}

function formatBodyText(example: unknown): string {
  return typeof example === "string" ? example : JSON.stringify(example, null, 2);
}

function stringifyExampleValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function firstExampleValue(examples: unknown): unknown {
  const firstExample = Object.values(toRecord(examples))[0];
  if (isRecord(firstExample) && "value" in firstExample) return firstExample.value;
  return firstExample;
}

function firstPresent(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function stringAt(record: unknown, key: string): string | undefined {
  const value = toRecord(record)[key];
  return typeof value === "string" ? value : undefined;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is UnknownRecord {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value != null && value !== "";
}

/** Recursively render all nested object properties */
function convertTemplateSyntax<T>(obj: T): T {
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

function deleteUndefinedAttrs<T>(obj: T): T {
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

class ImportState {
  readonly #spec: UnknownRecord;
  readonly #idCount: Partial<Record<string, number>> = {};
  #sortPriority = 0;

  constructor(spec: UnknownRecord) {
    this.#spec = spec;
  }

  generateId(model: string): string {
    this.#idCount[model] = (this.#idCount[model] ?? -1) + 1;
    return `GENERATE_ID::${model.toUpperCase()}_${this.#idCount[model]}`;
  }

  nextSortPriority(): number {
    return this.#sortPriority++;
  }

  resolve(value: unknown, visitedRefs = new Set<string>()): unknown {
    if (!isRecord(value) || typeof value.$ref !== "string") return value;
    if (visitedRefs.has(value.$ref)) return {};

    const nextVisitedRefs = new Set(visitedRefs);
    nextVisitedRefs.add(value.$ref);

    if (!value.$ref.startsWith("#/")) return value;

    const resolved = value.$ref
      .slice(2)
      .split("/")
      .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
      .reduce<unknown>((current, part) => toRecord(current)[part], this.#spec);

    return this.resolve(resolved, nextVisitedRefs);
  }
}
