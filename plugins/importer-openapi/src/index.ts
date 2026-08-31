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
  workspaces: AtLeast<Workspace, "name" | "id" | "model" | "authentication">[];
  environments: AtLeast<Environment, "name" | "id" | "model" | "workspaceId" | "variables">[];
  folders: AtLeast<Folder, "name" | "id" | "model" | "workspaceId">[];
  httpRequests: AtLeast<HttpRequest, "name" | "id" | "model" | "workspaceId">[];
};
type ImportedAuthentication = Pick<HttpRequest, "authentication" | "authenticationType"> & {
  headers: HttpRequestHeader[];
  urlParameters: HttpUrlParameter[];
};
type AuthenticationVariableRegistry = Map<string, { name: string; value: string }>;
type OAuthVariableNames = { clientId: string; clientSecret: string; redirectUri: string };
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
const MAX_SCHEMA_RESOLUTION_DEPTH = MAX_EXAMPLE_DEPTH;
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
    authentication: {},
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

  // Spec-level security is the default for every operation, which is exactly
  // Yaak's inheritance model: it lives on the workspace, and only operations
  // that declare their own security carry per-request authentication. API keys
  // materialized as headers or query parameters go onto inheriting requests
  // individually — workspace headers would also reach operations that override
  // or disable security, leaking the credential to endpoints that opted out.
  const workspaceAuthentication = importAuthentication({
    authenticationVariables,
    importState,
    oauthVariablesByScheme,
    security: spec.security,
    spec,
    useDynamicServerUrls: serverEnvironments.length > 1,
  });
  workspace.authentication = workspaceAuthentication.authentication;
  workspace.authenticationType = workspaceAuthentication.authenticationType;

  const folderIdsByTag = new Map<string, string>();
  const routeLabels = new Map<string, string>();
  const sourceKeys: Record<string, string> = {};
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
    sourceKeys[folder.id] = tagSourceKey(name);
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
        sourceKeys,
        workspaceId: workspace.id,
      });

      const request = importOperation({
        importState,
        inheritedAuthentication: workspaceAuthentication,
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
      sourceKeys[request.id] = operationSourceKey(
        stringAt(operation, "operationId"),
        method,
        rawPath,
      );
      resources.httpRequests.push(request);
    }
  }

  const authenticationConfigs = [workspace, ...resources.httpRequests];
  if (authenticationConfigs.some((model) => model.authenticationType === "oauth2")) {
    const variableNames = new Set(
      [...oauthVariablesByScheme.values()].flatMap(({ clientId, clientSecret }) => [
        clientId,
        clientSecret,
      ]),
    );
    // Only redirect-based grants reference the redirect variable, so don't
    // create it for specs that import as client_credentials or password
    for (const { redirectUri } of oauthVariablesByScheme.values()) {
      const used = authenticationConfigs.some(
        (model) =>
          model.authenticationType === "oauth2" &&
          Object.values(toRecord(model.authentication)).some(
            (value) => typeof value === "string" && value.includes(templateVariable(redirectUri)),
          ),
      );
      if (used) variableNames.add(redirectUri);
    }
    if (
      authenticationConfigs.some(
        (model) =>
          model.authenticationType === "oauth2" &&
          Object.values(toRecord(model.authentication)).some(
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
    resources: deleteUndefinedAttrs({
      environments: resources.environments,
      folders: resources.folders,
      grpcRequests: [],
      httpRequests: resources.httpRequests,
      websocketRequests: [],
      workspaces: resources.workspaces,
    }) as PartialImportResources,
    sourceKeys,
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
  inheritedAuthentication,
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
  inheritedAuthentication: ImportedAuthentication;
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
  // Operations without their own security inherit the workspace's (null
  // authenticationType), the same way an operation inherits spec security
  const hasOwnSecurity = Array.isArray(operation.security);
  const authentication = hasOwnSecurity
    ? importAuthentication({
        authenticationVariables,
        importState,
        oauthVariablesByScheme,
        security: operation.security,
        spec,
        useDynamicServerUrls,
      })
    : {
        ...emptyAuthentication(),
        headers: inheritedAuthentication.headers,
        urlParameters: inheritedAuthentication.urlParameters,
      };
  const url = buildOperationUrl(
    operationBaseUrl({ operation, pathItem, requestBaseUrl, serverOverrides }),
    path,
    parameters,
    importState,
  );
  const urlParameters = [
    ...importUrlParameters({ importState, parameters, path }),
    ...authentication.urlParameters,
  ];
  const headers = mergeHeaders(
    authentication.headers,
    importHeaderParameters({ importState, parameters }),
    importCookieHeader({ importState, parameters }),
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
    url,
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

/**
 * The spec requires string versions, but unquoted YAML like `swagger: 2.0`
 * parses as a number and such documents are common enough to accept.
 */
function isOpenApiSpec(value: unknown): value is UnknownRecord {
  const spec = toRecord(value);
  const openapi = versionString(spec.openapi);
  return isRecord(spec.paths) && (/^3(\.|$)/.test(openapi ?? "") || isSwagger2(spec));
}

function isSwagger2(spec: UnknownRecord): boolean {
  const swagger = versionString(spec.swagger);
  return swagger === "2.0" || swagger === "2";
}

function versionString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
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
  const line = value
    ?.split("\n")
    .find((l) => l.trim().length > 0)
    ?.trim();
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
  sourceKeys,
  workspaceId,
}: {
  folderIdsByTag: Map<string, string>;
  importState: ImportState;
  operation: UnknownRecord;
  resources: ImportResources;
  sourceKeys: Record<string, string>;
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
  sourceKeys[folder.id] = tagSourceKey(tag);
  return folder.id;
}

function operationSourceKey(operationId: string | undefined, method: string, path: string): string {
  return operationId != null && operationId !== ""
    ? `op:${operationId}`
    : `route:${method.toUpperCase()} ${path}`;
}

function tagSourceKey(tag: string): string {
  return `tag:${tag}`;
}

/**
 * Yaak's `:name` placeholders only substitute when they span a whole path
 * segment and hold a single plain value. Templates elsewhere in a segment
 * (like `/report.{format}`), styled ones (label, matrix), and array or object
 * values get their serialized example inlined instead — a placeholder row
 * cannot express them, and its leftover parameter would leak into the query
 * string.
 */
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
    const serialized = isRecord(parameter.content)
      ? encodePathComponent(serializeContentParameter(parameter, importState))
      : serializePathParameter(name, value, parameter, encodePathComponent);
    // A missing example stays a visible template rather than vanishing
    if (serialized.length === 0) continue;
    serializedPath = serializedPath.replaceAll(`{${name}}`, serialized);
  }
  return joinUrlParts(baseUrl, serializedPath.replaceAll(/(^|\/){([^}/]+)}(?=[/?#:]|$)/g, "$1:$2"));
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
  // A `:name` placeholder matches from the segment start up to a literal `:`,
  // so `{id}` and `{id}:cancel` stay placeholders while `report.{format}` can't
  const placeholderExpressible = matchingSegments.every(
    (segment) =>
      segment === template || (segment.startsWith(template) && segment[template.length] === ":"),
  );
  if (matchingSegments.length === 0 || !placeholderExpressible) return true;
  if (isRecord(parameter.content)) return false;
  const value = parameterExampleValue(parameter, importState);
  const style = stringAt(parameter, "style");
  return style === "label" || style === "matrix" || Array.isArray(value) || isRecord(value);
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
  return trimTrailingSlashes(joinUrlParts(`${scheme}://${host}`, stringAt(spec, "basePath") ?? ""));
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
      isSwagger2(spec) && (stringAt(spec, "host") != null || stringAt(spec, "basePath") != null);
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

/**
 * Request URLs are `${[baseUrl]}/path`, so a trailing slash here would put a
 * double slash on the wire. Trimming also turns a bare `/` server into "",
 * which renders the same URLs without a protocol-relative `//path`.
 */
function interpolateServerUrl(server: UnknownRecord): string {
  let url = stringAt(server, "url") ?? "";
  for (const [name, variable] of Object.entries(toRecord(server.variables))) {
    url = url.replaceAll(`{${name}}`, stringifyExampleValue(toRecord(variable).default));
  }
  return trimTrailingSlashes(url);
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
  // Path parameters are required by definition, and a disabled one would
  // leave the literal `:name` in the sent URL even for sloppy specs that
  // omit `required: true`
  const enabled = parameter.required === true || location === "path";
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
    const serialized = serializePathParameter(name, value, parameter);
    // An empty path segment makes a URL that matches nothing, so the name at
    // least keeps the request sendable and shows what belongs there
    return [{ enabled, name: `:${name}`, value: serialized.length > 0 ? serialized : name }];
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
    const { separator } = queryArraySerialization(parameter);
    if (separator == null) {
      return value.map((entryValue) => ({
        enabled,
        name,
        value: stringifyExampleValue(entryValue),
      }));
    }
    return [{ enabled, name, value: value.map(stringifyExampleValue).join(separator) }];
  }

  return [{ enabled, name, value: stringifyExampleValue(value) }];
}

/**
 * OpenAPI 3 query arrays default to form/explode, one parameter per item;
 * Swagger 2 defaults to comma-separated unless collectionFormat says otherwise.
 * A null separator means repeated parameters.
 */
function queryArraySerialization(parameter: UnknownRecord): { separator: string | null } {
  const collectionFormat = stringAt(parameter, "collectionFormat");
  if (collectionFormat != null || parameter.schema == null) {
    if (collectionFormat === "multi") return { separator: null };
    return {
      separator: { csv: ",", ssv: " ", tsv: "\t", pipes: "|" }[collectionFormat ?? "csv"] ?? ",",
    };
  }
  const style = stringAt(parameter, "style");
  if (style === "spaceDelimited") return { separator: " " };
  if (style === "pipeDelimited") return { separator: "|" };
  return parameter.explode === false ? { separator: "," } : { separator: null };
}

// The spec says header parameters with these names SHALL be ignored; Accept and
// Content-Type come from the operation's media types, Authorization from its
// security requirements
const IGNORED_HEADER_PARAMETERS = new Set(["accept", "authorization", "content-type"]);

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
    .filter((p) => !IGNORED_HEADER_PARAMETERS.has((stringAt(p, "name") ?? "").toLowerCase()))
    .map((p) => ({
      enabled: p.required === true,
      name: stringAt(p, "name") ?? "",
      value: serializeParameterValue(p, importState),
    }))
    .filter(({ name }) => name.length > 0);
}

/**
 * Yaak has no cookie parameter row, so each cookie parameter becomes its own
 * Cookie header. Rows stay individually toggleable and the send path merges
 * the enabled ones into a single header.
 */
function importCookieHeader({
  importState,
  parameters,
}: {
  importState: ImportState;
  parameters: unknown[];
}): HttpRequestHeader[] {
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
  // Exploded pairs are cookie pairs, which RFC 6265 separates with "; "
  if (Array.isArray(value)) {
    return explode
      ? value.map((entryValue) => `${name}=${stringifyExampleValue(entryValue)}`).join("; ")
      : `${name}=${value.map(stringifyExampleValue).join(",")}`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    return explode
      ? entries.map(([key, entryValue]) => `${key}=${stringifyExampleValue(entryValue)}`).join("; ")
      : `${name}=${entries.flat().map(stringifyExampleValue).join(",")}`;
  }
  return `${name}=${stringifyExampleValue(value)}`;
}

function serializeParameterValue(parameter: UnknownRecord, importState: ImportState): string {
  if (isRecord(parameter.content)) return serializeContentParameter(parameter, importState);
  return serializeSimpleParameter(parameterExampleValue(parameter, importState), parameter);
}

/** A parameter described by a media type serializes as that media type */
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

function parameterExampleValue(parameter: UnknownRecord, importState: ImportState): unknown {
  const directExample = firstPresent(
    parameter.example,
    firstExampleValue(parameter.examples, importState),
  );
  if (directExample != null) return directExample;
  if (isRecord(parameter.content)) {
    const mediaType = toRecord(Object.values(parameter.content)[0]);
    return mediaTypeExample(mediaType, importState);
  }
  // Swagger 2 parameters carry the schema keywords (type, items, default)
  // directly on the parameter object
  return schemaToExample(parameter.schema ?? parameter, importState);
}

function parameterExample(parameter: UnknownRecord, importState: ImportState): string {
  return serializeSimpleParameter(parameterExampleValue(parameter, importState), parameter);
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
    const contentType =
      toArray(operation.consumes ?? spec.consumes).find(
        (c): c is string => typeof c === "string",
      ) ?? "application/json";
    const schema = importState.resolveSchema(bodyParameter.schema);
    const isBinary = stringAt(schema, "format") === "binary";
    return {
      headers: [{ enabled: true, name: "Content-Type", value: contentType }],
      bodyType: isBinary ? "binary" : yaakBodyType(contentType),
      body: isBinary
        ? {}
        : {
            text: formatMediaTypeBody(
              contentType,
              schemaToExample(schema, importState),
              schema,
              importState,
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
      toArray(operation.consumes ?? spec.consumes).find(
        (c): c is string => typeof c === "string",
      ) ??
      (formParameters.some((p) => stringAt(p, "type") === "file")
        ? "multipart/form-data"
        : "application/x-www-form-urlencoded");
    return {
      headers: [{ enabled: true, name: "Content-Type", value: contentType }],
      bodyType: contentType,
      body: {
        form: formParameters.map((p) => {
          const base = {
            enabled: p.required === true,
            name: stringAt(p, "name") ?? "",
          };
          return stringAt(p, "type") === "file"
            ? { ...base, file: "" }
            : { ...base, value: parameterExample(p, importState) };
        }),
      },
    };
  }

  return { headers: [], body: {}, bodyType: null };
}

function importBodyFromContent(importState: ImportState, content: UnknownRecord) {
  const contentType = chooseContentType(Object.keys(content));
  if (contentType == null) return { headers: [], body: {}, bodyType: null };

  const mediaType = toRecord(content[contentType]);
  const bodyType = yaakBodyType(contentType);

  if (bodyType === "application/x-www-form-urlencoded" || bodyType === "multipart/form-data") {
    const example = mediaTypeExample(mediaType, importState);
    return {
      headers: [{ enabled: true, name: "Content-Type", value: contentType }],
      bodyType,
      body: {
        form: schemaToFormParameters(
          mediaType.schema,
          importState,
          isRecord(example) ? example : undefined,
        ),
      },
    };
  }

  const schema = importState.resolveSchema(mediaType.schema);
  const isBinary = bodyType === "binary" || stringAt(schema, "format") === "binary";

  return {
    headers: [{ enabled: true, name: "Content-Type", value: contentType }],
    bodyType: isBinary ? "binary" : bodyType,
    body: isBinary
      ? {}
      : {
          text: formatMediaTypeBody(
            contentType,
            mediaTypeExample(mediaType, importState),
            schema,
            importState,
          ),
        },
  };
}

function chooseContentType(contentTypes: string[]): string | null {
  const jsonType = contentTypes.find((contentType) => mediaTypeOf(contentType).endsWith("+json"));
  for (const preference of BODY_CONTENT_TYPE_PREFERENCE) {
    const exact = contentTypes.find((c) => mediaTypeOf(c) === preference);
    if (exact != null) return exact;
    // A +json suffix type ranks with JSON, ahead of the other preferences
    if (preference === "application/json" && jsonType != null) return jsonType;
  }
  return contentTypes[0] ?? null;
}

function formatMediaTypeBody(
  contentType: string,
  example: unknown,
  schema: unknown,
  importState: ImportState,
): string {
  const mediaType = mediaTypeOf(contentType);
  if (mediaType === "application/xml" || mediaType === "text/xml" || mediaType.endsWith("+xml")) {
    return typeof example === "string"
      ? example
      : valueToXml(example, schema, importState, "root", true);
  }
  if (mediaType === "application/json" || mediaType.endsWith("+json")) {
    // A string example may be pre-serialized JSON; otherwise it needs quoting
    // to be a valid JSON document
    if (typeof example === "string") {
      try {
        JSON.parse(example);
        return example;
      } catch {
        return JSON.stringify(example);
      }
    }
    return JSON.stringify(example, null, 2) ?? "";
  }
  return formatBodyText(example);
}

function valueToXml(
  value: unknown,
  schema: unknown,
  importState: ImportState,
  elementName: string,
  isDocumentRoot = false,
): string {
  const resolvedSchema = toRecord(importState.resolveSchema(schema));
  const schemaXml = toRecord(resolvedSchema.xml);
  if (Array.isArray(value)) {
    const itemSchema = importState.resolveSchema(resolvedSchema.items);
    const shouldWrap = schemaXml.wrapped === true || isDocumentRoot;
    const itemName =
      stringAt(toRecord(itemSchema).xml, "name") ??
      (shouldWrap ? (stringAt(schemaXml, "name") ?? elementName) : elementName);
    const items = value.map((item) => valueToXml(item, itemSchema, importState, itemName)).join("");
    return shouldWrap ? xmlElement(elementName, schemaXml, items) : items;
  }
  if (isRecord(value)) {
    const properties = toRecord(resolvedSchema.properties);
    const entries = Object.entries(value).map(([name, propertyValue]) => {
      const propertySchema = toRecord(importState.resolveSchema(properties[name]));
      return { name, propertyValue, propertySchema, xml: toRecord(propertySchema.xml) };
    });
    const usedPrefixes = new Set(["xml", "xmlns"]);
    const prefixesByNamespace = new Map<string, string>();
    for (const xml of [schemaXml, ...entries.map(({ xml }) => xml)]) {
      const namespace = stringAt(xml, "namespace");
      const prefix = stringAt(xml, "prefix");
      if (prefix == null || prefix.length === 0) continue;
      usedPrefixes.add(prefix);
      if (namespace != null && namespace.length > 0 && !prefixesByNamespace.has(namespace)) {
        prefixesByNamespace.set(namespace, prefix);
      }
    }
    const attributes: string[] = [];
    const attributeNamespaces: UnknownRecord[] = [];
    const children: string[] = [];
    for (const { name, propertyValue, propertySchema, xml } of entries) {
      if (xml.attribute === true) {
        const attributeXml = qualifyXmlAttribute(xml, usedPrefixes, prefixesByNamespace);
        attributes.push(
          `${qualifiedXmlName(name, attributeXml)}="${escapeXml(stringifyExampleValue(propertyValue))}"`,
        );
        attributeNamespaces.push(attributeXml);
      } else {
        children.push(valueToXml(propertyValue, propertySchema, importState, name));
      }
    }
    return xmlElement(elementName, schemaXml, children.join(""), attributes, attributeNamespaces);
  }
  return xmlElement(elementName, schemaXml, escapeXml(stringifyExampleValue(value)));
}

function xmlElement(
  fallbackName: string,
  xml: UnknownRecord,
  content: string,
  attributes: string[] = [],
  additionalNamespaces: UnknownRecord[] = [],
): string {
  const name = qualifiedXmlName(fallbackName, xml);
  const namespaces = new Map<string, string>();
  for (const metadata of [xml, ...additionalNamespaces]) {
    const namespace = stringAt(metadata, "namespace");
    if (namespace == null || namespace.length === 0) continue;
    const prefix = stringAt(metadata, "prefix");
    namespaces.set(prefix == null || prefix.length === 0 ? "xmlns" : `xmlns:${prefix}`, namespace);
  }
  const namespaceAttributes = [...namespaces].map(
    ([attribute, namespace]) => `${attribute}="${escapeXml(namespace)}"`,
  );
  const attributeText = [...namespaceAttributes, ...attributes].join(" ");
  const openingTag = attributeText.length > 0 ? `<${name} ${attributeText}>` : `<${name}>`;
  return `${openingTag}${content}</${name}>`;
}

function qualifyXmlAttribute(
  xml: UnknownRecord,
  usedPrefixes: Set<string>,
  prefixesByNamespace: Map<string, string>,
): UnknownRecord {
  const namespace = stringAt(xml, "namespace");
  const declaredPrefix = stringAt(xml, "prefix");
  if (namespace != null && namespace.length === 0) {
    const { prefix: _prefix, ...unqualifiedXml } = xml;
    return unqualifiedXml;
  }
  if (namespace == null || (declaredPrefix != null && declaredPrefix.length > 0)) return xml;

  // Namespaced attributes need a prefix to be well-formed, so reuse the
  // namespace's existing prefix or mint one
  const existingPrefix = prefixesByNamespace.get(namespace);
  if (existingPrefix != null) return { ...xml, prefix: existingPrefix };

  let suffix = 1;
  while (usedPrefixes.has(`ns${suffix}`)) suffix++;
  const generatedPrefix = `ns${suffix}`;
  usedPrefixes.add(generatedPrefix);
  prefixesByNamespace.set(namespace, generatedPrefix);
  return { ...xml, prefix: generatedPrefix };
}

function qualifiedXmlName(fallbackName: string, xml: UnknownRecord): string {
  const name = stringAt(xml, "name") ?? fallbackName;
  const prefix = stringAt(xml, "prefix");
  return prefix == null || prefix.length === 0 ? name : `${prefix}:${name}`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function mediaTypeOf(contentType: string): string {
  return contentType.toLowerCase().split(";")[0]?.trim() ?? "";
}

/**
 * Yaak's body editors key off a fixed set of body types, while the Content-Type
 * header keeps the spec's exact media type. Anything unrecognized becomes
 * "other", the app's plain-text body with an explicit Content-Type.
 */
function yaakBodyType(contentType: string): string {
  const mediaType = mediaTypeOf(contentType);
  if (mediaType === "application/json" || mediaType.endsWith("+json")) return "application/json";
  if (mediaType === "application/xml" || mediaType === "text/xml" || mediaType.endsWith("+xml")) {
    return "text/xml";
  }
  if (mediaType === "application/x-www-form-urlencoded" || mediaType === "multipart/form-data") {
    return mediaType;
  }
  if (mediaType === "application/octet-stream") return "binary";
  return "other";
}

function mediaTypeExample(mediaType: UnknownRecord, importState: ImportState): unknown {
  const directExample = firstPresent(
    mediaType.example,
    firstExampleValue(mediaType.examples, importState),
  );
  if (directExample != null) return directExample;
  return schemaToExample(mediaType.schema, importState);
}

function schemaToFormParameters(
  schema: unknown,
  importState: ImportState,
  example?: UnknownRecord,
) {
  const resolvedSchema = toRecord(importState.resolveSchema(schema));
  const required = toArray(resolvedSchema.required).filter(
    (name): name is string => typeof name === "string",
  );
  const properties = Object.entries(toRecord(resolvedSchema.properties))
    .filter(([, property]) => toRecord(importState.resolveSchema(property)).readOnly !== true)
    .slice(0, MAX_EXAMPLE_PROPERTIES);

  return properties.map(([name, property]) => {
    const resolvedProperty = toRecord(importState.resolveSchema(property));
    const propertyExample = example?.[name] ?? schemaToExample(resolvedProperty, importState);
    const base = {
      enabled: required.includes(name),
      name,
    };
    if (stringAt(resolvedProperty, "format") === "binary") {
      return { ...base, file: "" };
    }
    return { ...base, value: stringifyExampleValue(propertyExample) };
  });
}

function schemaToExample(
  schema: unknown,
  importState: ImportState,
  depth = 0,
  visitedRefs = new Set<string>(),
): unknown {
  if (depth > MAX_EXAMPLE_DEPTH) return {};

  const schemaRecord = toRecord(schema);
  const ref = stringAt(schemaRecord, "$ref");
  const closesReferenceCycle = ref != null && visitedRefs.has(ref);
  const nextVisitedRefs = new Set(visitedRefs);
  if (ref != null) nextVisitedRefs.add(ref);

  const resolved = importState.resolveSchema(schema, visitedRefs);
  if (!isRecord(resolved)) return "";
  if (closesReferenceCycle && Object.keys(resolved).length === 0) return {};

  const explicitExample = firstPresent(
    resolved.example,
    firstExampleValue(resolved.examples, importState),
    resolved.const,
    resolved.default,
  );
  if (explicitExample != null) return coerceToDeclaredType(explicitExample, resolved);

  const enumValues = toArray(resolved.enum);
  if (enumValues.length > 0) return enumValues[0];

  const propertyExample = schemaPropertiesToExample(resolved, importState, depth, nextVisitedRefs);
  const allOf = toArray(resolved.allOf);
  if (allOf.length > 0) {
    const compositionExample = allOf.reduce<UnknownRecord>((merged, childSchema) => {
      const childExample = schemaToExample(childSchema, importState, depth + 1, nextVisitedRefs);
      return isRecord(childExample) ? mergeExampleRecords(merged, childExample) : merged;
    }, {});
    return mergeExampleRecords(compositionExample, propertyExample);
  }

  const oneOf = toArray(resolved.oneOf);
  const anyOf = toArray(resolved.anyOf);
  if (oneOf.length > 0 || anyOf.length > 0) {
    const compositionExample = schemaToExample(
      oneOf[0] ?? anyOf[0],
      importState,
      depth + 1,
      nextVisitedRefs,
    );
    return Object.keys(propertyExample).length > 0
      ? mergeExampleRecords(isRecord(compositionExample) ? compositionExample : {}, propertyExample)
      : compositionExample;
  }

  const type = inferSchemaType(resolved);
  if (type === "array") {
    return [schemaToExample(resolved.items, importState, depth + 1, nextVisitedRefs)];
  }
  if (type === "object") return propertyExample;
  if (type === "integer" || type === "number") return 0;
  if (type === "boolean") return false;
  return FORMAT_EXAMPLES[stringAt(resolved, "format") ?? ""] ?? "";
}

/** Request examples omit readOnly properties, which only appear in responses */
function schemaPropertiesToExample(
  schema: UnknownRecord,
  importState: ImportState,
  depth: number,
  visitedRefs: Set<string>,
): UnknownRecord {
  const required = toArray(schema.required).filter(
    (name): name is string => typeof name === "string",
  );
  const properties = Object.entries(toRecord(schema.properties))
    .filter(([, property]) => toRecord(importState.resolveSchema(property)).readOnly !== true)
    .sort(([a], [b]) => {
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

function mergeExampleRecords(base: UnknownRecord, overlay: UnknownRecord): UnknownRecord {
  const merged = { ...base };
  for (const [name, value] of Object.entries(overlay)) {
    const baseValue = merged[name];
    merged[name] =
      isRecord(baseValue) && isRecord(value) ? mergeExampleRecords(baseValue, value) : value;
  }
  return merged;
}

const FORMAT_EXAMPLES: Record<string, string> = {
  "date-time": "2026-01-01T00:00:00Z",
  date: "2026-01-01",
  email: "user@example.com",
  hostname: "example.com",
  ipv4: "127.0.0.1",
  ipv6: "::1",
  uri: "https://example.com",
  url: "https://example.com",
  uuid: "00000000-0000-0000-0000-000000000000",
};

/**
 * YAML coerces unquoted scalars, so specs routinely carry `example: 12345` on a
 * `type: string` field. Sending the number fails the spec's own schema, and the
 * declared type is the author's stated intent.
 */
function coerceToDeclaredType(example: unknown, schema: UnknownRecord): unknown {
  const rawType = schema.type;
  const declared =
    typeof rawType === "string"
      ? rawType
      : Array.isArray(rawType)
        ? rawType.find((t) => t !== "null")
        : null;

  if (declared === "string" && (typeof example === "number" || typeof example === "boolean")) {
    return String(example);
  }
  if (
    (declared === "integer" || declared === "number") &&
    typeof example === "string" &&
    example.trim() !== "" &&
    Number.isFinite(Number(example))
  ) {
    return Number(example);
  }
  return example;
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

/**
 * Security Requirement Objects are ordered alternatives, so the first one this
 * importer can represent wins. That makes `[{bearer}, {}]` import the bearer
 * auth the author listed first, while `[{}, {bearer}]` imports as anonymous.
 */
function importAuthentication({
  authenticationVariables,
  importState,
  oauthVariablesByScheme,
  security,
  spec,
  useDynamicServerUrls,
}: {
  authenticationVariables: AuthenticationVariableRegistry;
  importState: ImportState;
  oauthVariablesByScheme: Map<string, OAuthVariableNames>;
  security: unknown;
  spec: UnknownRecord;
  useDynamicServerUrls: boolean;
}): ImportedAuthentication {
  if (!Array.isArray(security)) return emptyAuthentication();
  if (security.length === 0) {
    return { ...emptyAuthentication(), authenticationType: "none" };
  }

  const schemes = {
    ...toRecord(toRecord(spec.components).securitySchemes),
    ...toRecord(spec.securityDefinitions),
  };
  for (const rawRequirement of security) {
    if (!isRecord(rawRequirement)) continue;
    if (Object.keys(rawRequirement).length === 0) {
      return { ...emptyAuthentication(), authenticationType: "none" };
    }

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

  // Declared security this importer cannot represent (e.g. mutualTLS alone)
  // should not fall back to inheriting some other authentication
  return { ...emptyAuthentication(), authenticationType: "none" };
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
          redirectUri: "oauth_redirect_uri",
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
            redirectUri: templateVariable(variableNames.redirectUri),
          }
        : grantType === "implicit"
          ? {
              authorizationUrl,
              redirectUri: templateVariable(variableNames.redirectUri),
            }
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
        {
          clientId: `${prefix}_client_id`,
          clientSecret: `${prefix}_client_secret`,
          redirectUri: `${prefix}_redirect_uri`,
        },
      ];
    }),
  );
}

/** Earlier groups win on a name collision; Cookie rows all pass through since the send path merges them */
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

/**
 * `examples` is a map of (possibly `$ref`) Example objects on media types and
 * parameters, but a plain array of values on OpenAPI 3.1 schemas.
 */
function firstExampleValue(examples: unknown, importState: ImportState): unknown {
  if (Array.isArray(examples)) return examples[0];
  const firstExample = importState.resolve(Object.values(toRecord(examples))[0]);
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

    return this.resolve(this.#resolveLocalReference(value.$ref), nextVisitedRefs);
  }

  /** Schema Objects allow `$ref` siblings in OpenAPI 3.1 and later. */
  resolveSchema(value: unknown, visitedRefs = new Set<string>(), compositionDepth = 0): unknown {
    if (!isRecord(value)) return value;

    let resolved: unknown = value;
    const structureVisitedRefs = new Set(visitedRefs);
    const siblingLayers: UnknownRecord[] = [];
    while (isRecord(resolved) && typeof resolved.$ref === "string") {
      const ref = resolved.$ref;
      const siblings = Object.fromEntries(
        Object.entries(resolved).filter(([key]) => key !== "$ref"),
      );
      if (structureVisitedRefs.has(ref)) {
        resolved = siblings;
        break;
      }
      if (!ref.startsWith("#/")) {
        this.#unresolvedRefs.add(ref);
        break;
      }

      structureVisitedRefs.add(ref);
      siblingLayers.push(siblings);
      resolved = this.#resolveLocalReference(ref);
    }
    if (!isRecord(resolved)) return resolved;

    let merged: UnknownRecord = resolved;
    for (let index = siblingLayers.length - 1; index >= 0; index--) {
      merged = this.#mergeSchemaObjects(merged, siblingLayers[index] ?? {});
    }
    return this.#mergeAllOfStructure(merged, structureVisitedRefs, compositionDepth);
  }

  #mergeAllOfStructure(
    schema: UnknownRecord,
    visitedRefs: Set<string>,
    depth: number,
  ): UnknownRecord {
    if (depth > MAX_SCHEMA_RESOLUTION_DEPTH) return schema;
    const allOf = toArray(schema.allOf);
    if (allOf.length === 0) return schema;

    const composed = allOf.reduce<UnknownRecord>((merged, childSchema) => {
      const child = this.resolveSchema(childSchema, new Set(visitedRefs), depth + 1);
      if (!isRecord(child)) return merged;
      const childStructure = Object.fromEntries(
        Object.entries(child).filter(([key]) => key !== "allOf"),
      );
      return this.#mergeSchemaObjects(merged, childStructure);
    }, {});
    return this.#mergeSchemaObjects(composed, schema);
  }

  #mergeSchemaObjects(base: UnknownRecord, overlay: UnknownRecord, depth = 0): UnknownRecord {
    const merged: UnknownRecord = { ...base, ...overlay };
    if (depth > MAX_SCHEMA_RESOLUTION_DEPTH) return merged;

    const baseProperties = toRecord(base.properties);
    const overlayProperties = toRecord(overlay.properties);
    const propertyNames = new Set([
      ...Object.keys(baseProperties),
      ...Object.keys(overlayProperties),
    ]);
    if (propertyNames.size > 0) {
      merged.properties = Object.fromEntries(
        [...propertyNames].map((name) => {
          const baseProperty = baseProperties[name];
          const overlayProperty = overlayProperties[name];
          if (isRecord(baseProperty) && isRecord(overlayProperty)) {
            return [name, this.#mergeSchemaObjects(baseProperty, overlayProperty, depth + 1)];
          }
          return [name, overlayProperty ?? baseProperty];
        }),
      );
    }

    const baseRequired = toArray(base.required).filter(
      (name): name is string => typeof name === "string",
    );
    const overlayRequired = toArray(overlay.required).filter(
      (name): name is string => typeof name === "string",
    );
    if (baseRequired.length > 0 || overlayRequired.length > 0) {
      merged.required = [...new Set([...baseRequired, ...overlayRequired])];
    }

    const baseAllOf = toArray(base.allOf);
    const overlayAllOf = toArray(overlay.allOf);
    if (baseAllOf.length > 0 && overlayAllOf.length > 0) {
      merged.allOf = [...baseAllOf, ...overlayAllOf];
    }
    if (isRecord(base.xml) && isRecord(overlay.xml)) {
      merged.xml = { ...base.xml, ...overlay.xml };
    }
    if (isRecord(base.items) && isRecord(overlay.items)) {
      merged.items = this.#mergeSchemaObjects(base.items, overlay.items, depth + 1);
    }
    if (isRecord(base.additionalProperties) && isRecord(overlay.additionalProperties)) {
      merged.additionalProperties = this.#mergeSchemaObjects(
        base.additionalProperties,
        overlay.additionalProperties,
        depth + 1,
      );
    }

    return merged;
  }

  #resolveLocalReference(ref: string): unknown {
    return ref
      .slice(2)
      .split("/")
      .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
      .reduce<unknown>(
        (current, part) =>
          Array.isArray(current) ? current[Number(part)] : toRecord(current)[part],
        this.#spec,
      );
  }
}
