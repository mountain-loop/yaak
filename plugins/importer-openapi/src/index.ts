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
type ImportedAuthentication = Pick<HttpRequest, "authentication" | "authenticationType"> & {
  headers: HttpRequestHeader[];
  urlParameters: HttpUrlParameter[];
};
type AuthenticationVariableRegistry = Map<string, { name: string; value: string }>;
type OAuthVariableNames = { clientId: string; clientSecret: string };
type ServerOverrideVariable = { name: string; value: string };

const HTTP_METHODS = ["delete", "get", "head", "options", "patch", "post", "put", "query", "trace"];
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
const MAX_NAME_LENGTH = 100;

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
  const authenticationVariables: AuthenticationVariableRegistry = new Map();
  const oauthVariablesByScheme = buildOAuthVariablesByScheme(importState, spec);
  const serverOverrides = new Map<string, ServerOverrideVariable>();
  const baseUrl = importBaseUrl(spec);
  const serverEnvironments = importServerEnvironments(spec);
  // A local spec has no document URL against which OpenAPI's implicit "/"
  // server can resolve. Keep the shared variable even when its initial value
  // is empty so users can configure the host once instead of editing requests.
  const requestBaseUrl = "${[baseUrl]}";
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

  const folderIdsByTag = new Map<string, string>();
  const routeLabels = new Map<string, string>();
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
    for (const { method, operation } of pathItemOperations(pathItem, importState)) {
      const folderId = findOrCreateFolderId({
        folderIdsByTag,
        importState,
        operation,
        resources,
        workspaceId: workspace.id,
      });

      const request = importOperation({
        importState,
        method,
        operation,
        oauthVariablesByScheme,
        path: rawPath,
        pathItem,
        pathParameters,
        requestBaseUrl,
        serverOverrides,
        useDynamicServerUrls: serverEnvironments.length > 1,
        spec,
        workspaceId: workspace.id,
        folderId,
        authenticationVariables,
      });
      routeLabels.set(request.id, `${method.toUpperCase()} ${rawPath}`);
      resources.httpRequests.push(request);
    }
  }

  if (resources.httpRequests.some((request) => request.authenticationType === "oauth2")) {
    const variableNames = new Set(
      [...oauthVariablesByScheme.values()].flatMap(({ clientId, clientSecret }) => [
        clientId,
        clientSecret,
      ]),
    );
    if (
      resources.httpRequests.some(
        (request) =>
          request.authenticationType === "oauth2" &&
          Object.values(toRecord(request.authentication)).some(
            (value) =>
              typeof value === "string" && value.includes(templateVariable("baseUrlOrigin")),
          ),
      )
    ) {
      variableNames.add("baseUrlOrigin");
    }
    resources.environments[0]?.variables.push(
      ...[...variableNames].map((name) => ({ name, value: "" })),
    );
  }

  if (resources.httpRequests.length === 0) return undefined;

  const baseEnvironment = resources.environments[0];
  if (baseEnvironment == null) return undefined;
  baseEnvironment.variables.push(...authenticationVariables.values());

  const environmentSpecificVariables = baseEnvironment.variables;
  baseEnvironment.variables = [...serverOverrides.values()];
  resources.environments.push(
    ...serverEnvironments.map(({ name, url }) => ({
      model: "environment" as const,
      id: importState.generateId("environment"),
      workspaceId: workspace.id,
      name,
      variables: environmentSpecificVariables.map((variable) => ({
        ...variable,
        value:
          variable.name === "baseUrl"
            ? url
            : variable.name === "baseUrlOrigin"
              ? serverUrlOrigin(url)
              : variable.value,
      })),
      parentModel: "environment" as const,
      parentId: null,
      sortPriority: importState.nextSortPriority(),
    })),
  );

  disambiguateNames(resources.httpRequests, routeLabels);

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

/** OpenAPI 3.2 adds QUERY plus a map for extension HTTP methods. */
function pathItemOperations(
  pathItem: UnknownRecord,
  importState: ImportState,
): { method: string; operation: UnknownRecord }[] {
  const operations = HTTP_METHODS.flatMap((method) => {
    const operation = importState.resolve(pathItem[method]);
    return isRecord(operation) ? [{ method, operation }] : [];
  });

  for (const [method, rawOperation] of Object.entries(toRecord(pathItem.additionalOperations))) {
    if (HTTP_METHODS.includes(method.toLowerCase())) continue;
    const operation = importState.resolve(rawOperation);
    if (isRecord(operation)) operations.push({ method, operation });
  }
  return operations;
}

/**
 * Two operations sharing a summary are indistinguishable once imported, so the
 * colliding ones get their route appended. Names that are already unique within
 * their folder are left alone.
 */
function disambiguateNames(
  requests: ImportResources["httpRequests"],
  routeLabels: Map<string, string>,
): void {
  const counts = new Map<string, number>();
  for (const request of requests) {
    const key = `${request.folderId ?? ""} ${request.name}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  for (const request of requests) {
    const key = `${request.folderId ?? ""} ${request.name}`;
    const routeLabel = routeLabels.get(request.id);
    if ((counts.get(key) ?? 0) < 2 || routeLabel == null) continue;
    if (request.name === routeLabel) continue;
    request.name = `${request.name} (${routeLabel})`;
  }
}

function importOperation({
  importState,
  method,
  operation,
  oauthVariablesByScheme,
  path,
  pathItem,
  pathParameters,
  requestBaseUrl,
  serverOverrides,
  useDynamicServerUrls,
  spec,
  workspaceId,
  folderId,
  authenticationVariables,
}: {
  importState: ImportState;
  method: string;
  operation: UnknownRecord;
  oauthVariablesByScheme: Map<string, OAuthVariableNames>;
  path: string;
  pathItem: UnknownRecord;
  pathParameters: unknown[];
  requestBaseUrl: string;
  serverOverrides: Map<string, ServerOverrideVariable>;
  useDynamicServerUrls: boolean;
  spec: UnknownRecord;
  workspaceId: string;
  folderId: string | null;
  authenticationVariables: AuthenticationVariableRegistry;
}): ImportResources["httpRequests"][0] {
  importState.beginOperation();
  const parameters = mergeParameters({
    importState,
    pathParameters,
    operationParameters: toArray(operation.parameters),
  });
  const body = importBody({ importState, operation, parameters, spec });
  const authentication = importAuthentication({
    authenticationVariables,
    importState,
    oauthVariablesByScheme,
    operation,
    spec,
    useDynamicServerUrls,
  });
  const urlParameters = [
    ...importUrlParameters({ importState, parameters, path }),
    ...authentication.urlParameters,
  ];
  const headers = mergeHeaders(
    authentication.headers,
    importHeaderParameters({ importState, parameters }),
    body.headers,
    importAcceptHeader({ importState, operation, spec }),
  );
  const {
    headers: _authenticationHeaders,
    urlParameters: _authenticationParameters,
    ...auth
  } = authentication;

  // Built after everything else, so it can report the refs they left unresolved
  const description = importOperationDescription({
    importState,
    operation,
    parameters,
    bodyContentType: body.bodyType,
  });

  return {
    model: "http_request",
    id: importState.generateId("http_request"),
    workspaceId,
    folderId,
    name: importOperationName(operation, method, path),
    description,
    method: method.toUpperCase(),
    url: buildOperationUrl(
      operationBaseUrl({ operation, pathItem, requestBaseUrl, serverOverrides }),
      path,
      parameters,
      importState,
    ),
    urlParameters,
    headers,
    body: body.body,
    bodyType: body.bodyType,
    sortPriority: importState.nextSortPriority(),
    ...auth,
  };
}

/**
 * A parameter is identified by its name and location, and an operation may
 * redeclare one from its path item to change it. Keeping both copies would
 * import the stale one alongside the override, so the operation's wins.
 */
function mergeParameters({
  importState,
  pathParameters,
  operationParameters,
}: {
  importState: ImportState;
  pathParameters: unknown[];
  operationParameters: unknown[];
}): unknown[] {
  const merged: unknown[] = [];
  const indexByKey = new Map<string, number>();

  for (const parameter of [...pathParameters, ...operationParameters]) {
    const resolved = importState.resolve(parameter);
    const name = stringAt(resolved, "name");
    const location = stringAt(resolved, "in");
    // Anything missing an identity can't be matched up, so it is kept as-is
    if (name == null || location == null) {
      merged.push(resolved);
      continue;
    }

    const key = `${location} ${name}`;
    const existing = indexByKey.get(key);
    if (existing == null) {
      indexByKey.set(key, merged.length);
      merged.push(resolved);
    } else {
      merged[existing] = resolved;
    }
  }

  return merged;
}

/** Operation-level `servers` beat path-level, which beat the spec-level base URL */
function operationBaseUrl({
  operation,
  pathItem,
  requestBaseUrl,
  serverOverrides,
}: {
  operation: UnknownRecord;
  pathItem: UnknownRecord;
  requestBaseUrl: string;
  serverOverrides: Map<string, ServerOverrideVariable>;
}): string {
  for (const servers of [operation.servers, pathItem.servers]) {
    const override = toArray(servers)
      .map((s) => interpolateServerUrl(toRecord(s)))
      .find((url) => url.length > 0);
    if (override != null) {
      let variable = serverOverrides.get(override);
      if (variable == null) {
        const suffix = serverOverrides.size === 0 ? "" : String(serverOverrides.size + 1);
        variable = { name: `serverUrl${suffix}`, value: override };
        serverOverrides.set(override, variable);
      }
      return `\${[${variable.name}]}`;
    }
  }
  return requestBaseUrl;
}

/**
 * Swagger 2.0 declares response types up front in `produces`; OpenAPI 3 only
 * lists them per response, so successful responses stand in. Both become an
 * Accept header, which is what the Postman-based importer used to produce.
 */
function importAcceptHeader({
  importState,
  operation,
  spec,
}: {
  importState: ImportState;
  operation: UnknownRecord;
  spec: UnknownRecord;
}): HttpRequestHeader[] {
  const produces =
    toArray(operation.produces ?? spec.produces).find((c): c is string => typeof c === "string") ??
    successResponseContentType(importState, operation);
  // `*/*` is what a request accepts by default, so stating it just adds noise
  if (produces == null || produces === "*/*") return [];
  return [{ enabled: true, name: "Accept", value: produces }];
}

/** The content type of the first successful response, by the usual preference */
function successResponseContentType(
  importState: ImportState,
  operation: UnknownRecord,
): string | null {
  for (const [status, response] of Object.entries(toRecord(operation.responses))) {
    if (!status.startsWith("2") && status !== "default") continue;

    const content = toRecord(toRecord(importState.resolve(response)).content);
    const contentType = chooseContentType(Object.keys(content));
    if (contentType != null) return contentType;
  }
  return null;
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
    firstLine(stringAt(operation, "description")) ??
    `${method.toUpperCase()} ${path}`
  );
}

/**
 * Some specs describe an operation without ever summarizing it, and the opening
 * line is a far better name than the method and path. Paragraphs are left to the
 * description, since a name that long is no easier to scan than the path.
 */
function firstLine(value: string | undefined): string | undefined {
  const line = value?.split("\n").find((l) => l.trim().length > 0)?.trim();
  if (line == null || line.length > MAX_NAME_LENGTH) return undefined;
  return line;
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

  // Leads the description, since it changes whether the request should be used at all
  if (operation.deprecated === true) {
    parts.push("Deprecated.");
  }

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

  // Without this the parts these refs describe just come out blank
  const unresolvedRefs = importState.unresolvedRefs().slice(0, MAX_DESCRIPTION_ITEMS);
  if (unresolvedRefs.length > 0) {
    parts.push(
      [
        "Unresolved references (point outside this document, so the parts they describe were left empty):",
        ...unresolvedRefs.map((ref) => `- ${ref}`),
      ].join("\n"),
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

function buildOperationUrl(
  baseUrl: string,
  path: string,
  parameters: unknown[],
  importState: ImportState,
): string {
  let serializedPath = path;
  for (const rawParameter of parameters) {
    const parameter = importState.resolve(rawParameter);
    if (!isRecord(parameter) || !shouldInlinePathParameter(parameter, importState, path)) continue;

    const name = stringAt(parameter, "name") ?? "";
    if (name.length === 0) continue;
    const value = parameterExampleValue(parameter, importState);
    serializedPath = serializedPath.replaceAll(
      `{${name}}`,
      isRecord(parameter.content)
        ? encodePathComponent(serializeContentParameter(parameter, importState))
        : serializePathParameter(name, value, parameter, encodePathComponent),
    );
  }
  return joinUrlParts(baseUrl, serializedPath.replaceAll(/{([^}/]+)}/g, ":$1"));
}

function shouldInlinePathParameter(
  parameter: UnknownRecord,
  importState: ImportState,
  path: string,
): boolean {
  if (stringAt(parameter, "in") !== "path") return false;
  const name = stringAt(parameter, "name") ?? "";
  const template = `{${name}}`;
  const matchingSegments = path.split("/").filter((segment) => segment.includes(template));
  if (matchingSegments.length === 0 || matchingSegments.some((segment) => segment !== template)) {
    return true;
  }
  if (isRecord(parameter.content)) return false;
  const value = parameterExampleValue(parameter, importState);
  const style = stringAt(parameter, "style");
  return (
    style === "label" ||
    style === "matrix" ||
    Array.isArray(value) ||
    isRecord(value)
  );
}

function encodePathComponent(value: unknown): string {
  return encodeURIComponent(stringifyExampleValue(value)).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
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

function importServerEnvironments(spec: UnknownRecord): { name: string; url: string }[] {
  const servers = toArray(spec.servers)
    .map(toRecord)
    .map((server, index) => ({
      name: stringAt(server, "description")?.trim() || `Server ${index + 1}`,
      url: interpolateServerUrl(server),
    }))
    .filter(({ url }) => url.length > 0);
  if (servers.length === 0) {
    const hasSwaggerServer =
      stringAt(spec, "swagger") === "2.0" &&
      (stringAt(spec, "host") != null || stringAt(spec, "basePath") != null);
    return [
      {
        name: hasSwaggerServer ? "Server 1" : "Default",
        url: hasSwaggerServer ? importBaseUrl(spec) : "",
      },
    ];
  }

  const nameCounts = new Map<string, number>();
  return servers.map((server) => {
    const count = (nameCounts.get(server.name) ?? 0) + 1;
    nameCounts.set(server.name, count);
    return { ...server, name: count === 1 ? server.name : `${server.name} ${count}` };
  });
}

function serverUrlOrigin(value: string): string {
  try {
    const origin = new URL(value).origin;
    return origin === "null" ? "" : origin;
  } catch {
    if (!value.startsWith("//")) return "";
    try {
      return `//${new URL(`https:${value}`).host}`;
    } catch {
      return "";
    }
  }
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
  path,
}: {
  importState: ImportState;
  parameters: unknown[];
  path: string;
}): HttpUrlParameter[] {
  return parameters
    .map((p) => importState.resolve(p))
    .filter(isRecord)
    .filter((p) => stringAt(p, "in") === "query" || stringAt(p, "in") === "path")
    .flatMap((p) => serializeUrlParameter(p, importState, path))
    .filter(({ name }) => name.length > 0);
}

function serializeUrlParameter(
  parameter: UnknownRecord,
  importState: ImportState,
  path: string,
): HttpUrlParameter[] {
  const name = stringAt(parameter, "name") ?? "";
  const location = stringAt(parameter, "in");
  const enabled = parameter.required === true;
  const value = parameterExampleValue(parameter, importState);
  if (isRecord(parameter.content)) {
    return [
      {
        enabled,
        name: location === "path" ? `:${name}` : name,
        value: serializeContentParameter(parameter, importState),
      },
    ];
  }
  if (location === "path") {
    if (shouldInlinePathParameter(parameter, importState, path)) return [];
    return [{ enabled, name: `:${name}`, value: serializePathParameter(name, value, parameter) }];
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    const style = stringAt(parameter, "style") ?? "form";
    const explode = parameter.explode !== false;
    if (style === "deepObject") {
      return entries.map(([key, entryValue]) => ({
        enabled,
        name: `${name}[${key}]`,
        value: stringifyExampleValue(entryValue),
      }));
    }
    if (style === "form" && explode) {
      return entries.map(([key, entryValue]) => ({
        enabled,
        name: key,
        value: stringifyExampleValue(entryValue),
      }));
    }
    const separator = style === "spaceDelimited" ? " " : style === "pipeDelimited" ? "|" : ",";
    return [{ enabled, name, value: entries.flat().map(stringifyExampleValue).join(separator) }];
  }

  if (Array.isArray(value)) {
    const style = stringAt(parameter, "style") ?? "form";
    const explode = parameter.explode !== false;
    if (style === "form" && explode) {
      return value.map((entryValue) => ({
        enabled,
        name,
        value: stringifyExampleValue(entryValue),
      }));
    }
    const separator = style === "spaceDelimited" ? " " : style === "pipeDelimited" ? "|" : ",";
    return [{ enabled, name, value: value.map(stringifyExampleValue).join(separator) }];
  }

  return [{ enabled, name, value: stringifyExampleValue(value) }];
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
    .filter(
      (p) =>
        !["accept", "authorization", "content-type"].includes(
          (stringAt(p, "name") ?? "").toLowerCase(),
        ),
    )
    .map((p) => ({
      enabled: p.required === true,
      name: stringAt(p, "name") ?? "",
      value: serializeParameterValue(p, importState),
    }))
    .filter(({ name }) => name.length > 0)
    .concat(importCookieHeader(parameters, importState));
}

function importCookieHeader(parameters: unknown[], importState: ImportState): HttpRequestHeader[] {
  return parameters
    .map((p) => importState.resolve(p))
    .filter(isRecord)
    .filter((p) => stringAt(p, "in") === "cookie")
    .map((p) => ({
      enabled: p.required === true,
      name: "Cookie",
      value: serializeCookieParameter(p, importState),
    }))
    .filter(({ value }) => value.length > 0);
}

function serializeCookieParameter(parameter: UnknownRecord, importState: ImportState): string {
  const name = stringAt(parameter, "name") ?? "";
  if (name.length === 0) return "";
  if (isRecord(parameter.content)) {
    return `${name}=${serializeContentParameter(parameter, importState)}`;
  }

  const value = parameterExampleValue(parameter, importState);
  const explode = parameter.explode !== false;
  if (Array.isArray(value)) {
    return explode
      ? value.map((entryValue) => `${name}=${stringifyExampleValue(entryValue)}`).join("&")
      : `${name}=${value.map(stringifyExampleValue).join(",")}`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    return explode
      ? entries.map(([key, entryValue]) => `${key}=${stringifyExampleValue(entryValue)}`).join("&")
      : `${name}=${entries.flat().map(stringifyExampleValue).join(",")}`;
  }
  return `${name}=${stringifyExampleValue(value)}`;
}

function serializeParameterValue(parameter: UnknownRecord, importState: ImportState): string {
  if (isRecord(parameter.content)) return serializeContentParameter(parameter, importState);
  return serializeSimpleParameter(parameterExampleValue(parameter, importState), parameter);
}

function serializeContentParameter(parameter: UnknownRecord, importState: ImportState): string {
  const [contentType, rawMediaType] = Object.entries(toRecord(parameter.content))[0] ?? [];
  const value = mediaTypeExample(toRecord(rawMediaType), importState);
  return contentType?.toLowerCase().includes("json")
    ? (JSON.stringify(value) ?? "")
    : stringifyExampleValue(value);
}

function serializePathParameter(
  name: string,
  value: unknown,
  parameter: UnknownRecord,
  serializeValue: (value: unknown) => string = stringifyExampleValue,
): string {
  const style = stringAt(parameter, "style") ?? "simple";
  const explode = parameter.explode === true;
  const values = Array.isArray(value)
    ? value.map(serializeValue)
    : isRecord(value)
      ? Object.entries(value).flatMap(([key, entryValue]) => [
          serializeValue(key),
          serializeValue(entryValue),
        ])
      : [serializeValue(value)];

  if (style === "label") {
    if (explode && isRecord(value)) {
      return `.${Object.entries(value)
        .map(([key, entryValue]) => `${serializeValue(key)}=${serializeValue(entryValue)}`)
        .join(".")}`;
    }
    return `.${values.join(explode ? "." : ",")}`;
  }
  if (style === "matrix") {
    if (explode && Array.isArray(value)) {
      return value.map((entryValue) => `;${name}=${serializeValue(entryValue)}`).join("");
    }
    if (explode && isRecord(value)) {
      return Object.entries(value)
        .map(([key, entryValue]) => `;${serializeValue(key)}=${serializeValue(entryValue)}`)
        .join("");
    }
    return `;${name}=${values.join(",")}`;
  }
  return serializeSimpleParameter(value, parameter, serializeValue);
}

function serializeSimpleParameter(
  value: unknown,
  parameter: UnknownRecord,
  serializeValue: (value: unknown) => string = stringifyExampleValue,
): string {
  if (Array.isArray(value)) return value.map(serializeValue).join(",");
  if (isRecord(value)) {
    const entries = Object.entries(value);
    return parameter.explode === true
      ? entries
          .map(([key, entryValue]) => `${serializeValue(key)}=${serializeValue(entryValue)}`)
          .join(",")
      : entries.flat().map(serializeValue).join(",");
  }
  return serializeValue(value);
}

function parameterExample(parameter: UnknownRecord, importState: ImportState): string {
  return stringifyExampleValue(parameterExampleValue(parameter, importState));
}

function parameterExampleValue(parameter: UnknownRecord, importState: ImportState): unknown {
  const directExample = firstPresent(parameter.example, firstExampleValue(parameter.examples));
  if (directExample != null) return directExample;
  if (isRecord(parameter.content)) {
    const mediaType = toRecord(Object.values(parameter.content)[0]);
    return mediaTypeExample(mediaType, importState);
  }
  return schemaToExample(importState.resolve(parameter.schema), importState);
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
    const contentType = toArray(operation.consumes ?? spec.consumes).find(
      (c): c is string => typeof c === "string",
    );
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
      toArray(operation.consumes ?? spec.consumes).find((c): c is string => typeof c === "string") ??
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
  authenticationVariables,
  importState,
  oauthVariablesByScheme,
  operation,
  spec,
  useDynamicServerUrls,
}: {
  authenticationVariables: AuthenticationVariableRegistry;
  importState: ImportState;
  oauthVariablesByScheme: Map<string, OAuthVariableNames>;
  operation: UnknownRecord;
  spec: UnknownRecord;
  useDynamicServerUrls: boolean;
}): ImportedAuthentication {
  const security = operation.security ?? spec.security;
  if (Array.isArray(operation.security) && operation.security.length === 0) {
    return { ...emptyAuthentication(), authenticationType: "none" };
  }
  if (!Array.isArray(security) || security.length === 0) {
    return emptyAuthentication();
  }

  // Security Requirement Objects are alternatives. If any alternative is
  // empty, authentication is optional regardless of where it appears.
  if (
    security.some((requirement) => isRecord(requirement) && Object.keys(requirement).length === 0)
  ) {
    return { ...emptyAuthentication(), authenticationType: "none" };
  }

  const schemes = {
    ...toRecord(toRecord(spec.components).securitySchemes),
    ...toRecord(spec.securityDefinitions),
  };
  for (const rawRequirement of security) {
    if (!isRecord(rawRequirement)) continue;

    const imported = importSecurityRequirement({
      authenticationVariables,
      importState,
      oauthVariablesByScheme,
      requirement: rawRequirement,
      schemes,
      spec,
      useDynamicServerUrls,
    });
    if (imported != null) return imported;
  }

  return emptyAuthentication();
}

function importSecurityRequirement({
  authenticationVariables,
  importState,
  oauthVariablesByScheme,
  requirement,
  schemes,
  spec,
  useDynamicServerUrls,
}: {
  authenticationVariables: AuthenticationVariableRegistry;
  importState: ImportState;
  oauthVariablesByScheme: Map<string, OAuthVariableNames>;
  requirement: UnknownRecord;
  schemes: UnknownRecord;
  spec: UnknownRecord;
  useDynamicServerUrls: boolean;
}): ImportedAuthentication | null {
  const entries = Object.entries(requirement);
  const headers: HttpRequestHeader[] = [];
  const urlParameters: HttpUrlParameter[] = [];
  let primaryAuthentication: Pick<HttpRequest, "authentication" | "authenticationType"> | null =
    null;

  for (const [schemeName, rawScopes] of entries) {
    const scheme = toRecord(importState.resolve(schemes[schemeName]));
    const type = stringAt(scheme, "type");
    if (type === "apiKey") {
      const variable = registerAuthenticationVariable(authenticationVariables, schemeName, "key");
      if (entries.length === 1) {
        primaryAuthentication = {
          authenticationType: "apikey",
          authentication: importApiKey(scheme, schemeName, variable),
        };
      } else {
        materializeApiKey(scheme, schemeName, variable, headers, urlParameters);
      }
      continue;
    }

    let candidate: Pick<HttpRequest, "authentication" | "authenticationType"> | null = null;
    if (type === "oauth2") {
      candidate = importOAuth2(
        scheme,
        rawScopes,
        importBaseUrl(spec),
        oauthVariablesByScheme.get(schemeName) ?? {
          clientId: "oauth_client_id",
          clientSecret: "oauth_client_secret",
        },
        useDynamicServerUrls,
      );
    } else if (type === "openIdConnect") {
      const token = registerAuthenticationVariable(authenticationVariables, schemeName, "token");
      candidate = {
        authenticationType: "bearer",
        authentication: { token: templateVariable(token), prefix: "Bearer" },
      };
    } else if (type === "basic" || (type === "http" && schemeIs(scheme, "basic"))) {
      const username = registerAuthenticationVariable(
        authenticationVariables,
        schemeName,
        "username",
      );
      const password = registerAuthenticationVariable(
        authenticationVariables,
        schemeName,
        "password",
      );
      candidate = {
        authenticationType: "basic",
        authentication: {
          username: templateVariable(username),
          password: templateVariable(password),
        },
      };
    } else if (type === "http" && schemeIs(scheme, "bearer")) {
      const token = registerAuthenticationVariable(authenticationVariables, schemeName, "token");
      candidate = {
        authenticationType: "bearer",
        authentication: { token: templateVariable(token), prefix: "Bearer" },
      };
    }

    // A requirement is an AND. Yaak can combine one auth plugin with explicit
    // API-key parameters, but cannot represent two auth plugins on one request.
    if (candidate == null || primaryAuthentication != null) return null;
    primaryAuthentication = candidate;
  }

  return {
    ...(primaryAuthentication ?? {
      authenticationType: entries.length > 1 ? "none" : null,
      authentication: {},
    }),
    headers,
    urlParameters,
  };
}

function emptyAuthentication(): ImportedAuthentication {
  return {
    authenticationType: null,
    authentication: {},
    headers: [],
    urlParameters: [],
  };
}

function schemeIs(scheme: UnknownRecord, name: string): boolean {
  return stringAt(scheme, "scheme")?.toLowerCase() === name;
}

/**
 * The API key auth plugin can only write a header or a query parameter, so a
 * cookie key becomes the Cookie header it would have ended up in, pre-filled
 * with its name. Sending it as a header named after the cookie would just fail.
 */
function importApiKey(
  scheme: UnknownRecord,
  schemeName: string,
  variableName: string,
): Record<string, string> {
  const key = stringAt(scheme, "name") ?? schemeName;
  const location = stringAt(scheme, "in");
  const value = templateVariable(variableName);

  if (location === "cookie") {
    return { location: "header", key: "Cookie", value: `${key}=${value}` };
  }
  return { location: location === "query" ? "query" : "header", key, value };
}

function materializeApiKey(
  scheme: UnknownRecord,
  schemeName: string,
  variableName: string,
  headers: HttpRequestHeader[],
  urlParameters: HttpUrlParameter[],
): void {
  const key = stringAt(scheme, "name") ?? schemeName;
  const location = stringAt(scheme, "in");
  const value = templateVariable(variableName);
  if (location === "query") {
    urlParameters.push({ enabled: true, name: key, value });
  } else if (location === "cookie") {
    headers.push({ enabled: true, name: "Cookie", value: `${key}=${value}` });
  } else {
    headers.push({ enabled: true, name: key, value });
  }
}

function registerAuthenticationVariable(
  variables: AuthenticationVariableRegistry,
  schemeName: string,
  field: string,
): string {
  const identity = JSON.stringify([schemeName, field]);
  const existing = variables.get(identity);
  if (existing != null) return existing.name;

  const schemePart = schemeName
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replaceAll(/[^a-zA-Z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "")
    .toLowerCase();
  const baseName = `auth_${schemePart || "security"}_${field}`;
  let name = baseName;
  let suffix = 2;
  const names = new Set([...variables.values()].map((variable) => variable.name));
  while (names.has(name)) {
    name = `${baseName}_${suffix++}`;
  }
  variables.set(identity, { name, value: "" });
  return name;
}

function templateVariable(name: string): string {
  return `\${[${name}]}`;
}

/**
 * Maps an OpenAPI 3.x `flows` object or a Swagger 2.0 `flow` string onto the
 * grant types the OAuth 2.0 auth plugin understands. Returns null when the
 * scheme declares no flow this importer can map, so the caller keeps looking.
 */
function importOAuth2(
  scheme: UnknownRecord,
  rawScopes: unknown,
  baseUrl: string,
  variableNames: OAuthVariableNames,
  useDynamicServerUrls: boolean,
): Pick<HttpRequest, "authentication" | "authenticationType"> | null {
  const scope = toArray(rawScopes)
    .filter((s): s is string => typeof s === "string")
    .join(" ");

  const flows = toRecord(scheme.flows);
  const swagger2Flow = stringAt(scheme, "flow");
  const candidates: { grantType: string; flow: UnknownRecord }[] = [
    { grantType: "authorization_code", flow: toRecord(flows.authorizationCode) },
    { grantType: "client_credentials", flow: toRecord(flows.clientCredentials) },
    { grantType: "password", flow: toRecord(flows.password) },
    { grantType: "implicit", flow: toRecord(flows.implicit) },
  ];

  // Swagger 2.0 puts the URLs on the scheme itself and names the flow differently
  if (swagger2Flow != null) {
    const grantType = {
      accessCode: "authorization_code",
      application: "client_credentials",
      implicit: "implicit",
      password: "password",
    }[swagger2Flow];
    if (grantType == null) return null;
    candidates.unshift({ grantType, flow: scheme });
  }

  for (const { grantType, flow } of candidates) {
    const authorizationUrl = resolveOAuthUrl(
      stringAt(flow, "authorizationUrl"),
      baseUrl,
      useDynamicServerUrls,
    );
    const accessTokenUrl = resolveOAuthUrl(
      stringAt(flow, "tokenUrl"),
      baseUrl,
      useDynamicServerUrls,
    );
    if (authorizationUrl == null && accessTokenUrl == null) continue;

    const grantPatch =
      grantType === "authorization_code"
        ? {
            authorizationUrl,
            accessTokenUrl,
            clientSecret: templateVariable(variableNames.clientSecret),
          }
        : grantType === "implicit"
          ? { authorizationUrl }
          : grantType === "password"
            ? {
                accessTokenUrl,
                clientSecret: templateVariable(variableNames.clientSecret),
                username: "",
                password: "",
              }
            : {
                accessTokenUrl,
                clientSecret: templateVariable(variableNames.clientSecret),
              };

    return {
      authenticationType: "oauth2",
      authentication: {
        grantType,
        clientId: templateVariable(variableNames.clientId),
        headerPrefix: "Bearer",
        ...(scope.length > 0 ? { scope } : {}),
        ...grantPatch,
      },
    };
  }

  return null;
}

function resolveOAuthUrl(
  value: string | undefined,
  baseUrl: string,
  useDynamicServerUrls: boolean,
): string | undefined {
  if (value == null) return undefined;
  try {
    return new URL(value).toString();
  } catch {
    // Relative endpoint; resolve it against the API base below.
  }

  if (value.startsWith("//")) return value;
  if (useDynamicServerUrls) {
    return value.startsWith("/")
      ? `${templateVariable("baseUrlOrigin")}${value}`
      : joinUrlParts(templateVariable("baseUrl"), value);
  }

  if (baseUrl.length > 0) {
    try {
      return new URL(value, `${trimTrailingSlashes(baseUrl)}/`).toString();
    } catch {
      // A path-only server has no origin to resolve against. Preserve whether
      // the OAuth endpoint is relative to that path or to the eventual origin.
    }
  }

  try {
    const placeholderOrigin = "https://openapi-import.invalid";
    const relativeBase = new URL(`${trimTrailingSlashes(baseUrl)}/`, placeholderOrigin);
    const resolved = new URL(value, relativeBase);
    return `${templateVariable("baseUrlOrigin")}${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return joinUrlParts(templateVariable("baseUrlOrigin"), value);
  }
}

function buildOAuthVariablesByScheme(
  importState: ImportState,
  spec: UnknownRecord,
): Map<string, OAuthVariableNames> {
  const schemes = {
    ...toRecord(toRecord(spec.components).securitySchemes),
    ...toRecord(spec.securityDefinitions),
  };
  const oauthSchemeNames = Object.entries(schemes)
    .filter(([, scheme]) => stringAt(importState.resolve(scheme), "type") === "oauth2")
    .map(([name]) => name);
  const usedPrefixes = new Set<string>();

  return new Map(
    oauthSchemeNames.map((schemeName) => {
      const basePrefix =
        oauthSchemeNames.length === 1
          ? "oauth"
          : `oauth_${schemeName.replaceAll(/[^a-zA-Z0-9_]+/g, "_").replaceAll(/^_+|_+$/g, "") || "auth"}`;
      let prefix = basePrefix;
      let suffix = 2;
      while (usedPrefixes.has(prefix)) prefix = `${basePrefix}_${suffix++}`;
      usedPrefixes.add(prefix);
      return [
        schemeName,
        { clientId: `${prefix}_client_id`, clientSecret: `${prefix}_client_secret` },
      ];
    }),
  );
}

function mergeHeaders(...headerGroups: HttpRequestHeader[][]): HttpRequestHeader[] {
  const headers: HttpRequestHeader[] = [];
  for (const group of headerGroups) {
    const namesFromEarlierGroups = new Set(headers.map((header) => header.name.toLowerCase()));
    for (const header of group) {
      const name = header.name.toLowerCase();
      if (name === "cookie" || !namesFromEarlierGroups.has(name)) {
        headers.push(header);
      }
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
  #unresolvedRefs = new Set<string>();

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

  /** Starts collecting unresolved refs for a single operation */
  beginOperation(): void {
    this.#unresolvedRefs = new Set();
  }

  /** Refs seen since `beginOperation` that point outside this document */
  unresolvedRefs(): string[] {
    return [...this.#unresolvedRefs];
  }

  resolve(value: unknown, visitedRefs = new Set<string>()): unknown {
    if (!isRecord(value) || typeof value.$ref !== "string") return value;
    if (visitedRefs.has(value.$ref)) return {};

    const nextVisitedRefs = new Set(visitedRefs);
    nextVisitedRefs.add(value.$ref);

    // Refs into other documents can't be followed without fetching them, so
    // record them and let the operation description report what went missing
    if (!value.$ref.startsWith("#/")) {
      this.#unresolvedRefs.add(value.$ref);
      return value;
    }

    const resolved = value.$ref
      .slice(2)
      .split("/")
      .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
      .reduce<unknown>((current, part) => toRecord(current)[part], this.#spec);

    return this.resolve(resolved, nextVisitedRefs);
  }
}
