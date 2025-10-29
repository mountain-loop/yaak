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
} from '@yaakapp/api';
import type { ImportPluginResponse } from '@yaakapp/api/lib/plugins/ImporterPlugin';

const POSTMAN_2_1_0_SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';
const POSTMAN_2_0_0_SCHEMA = 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json';
const VALID_SCHEMAS = [POSTMAN_2_0_0_SCHEMA, POSTMAN_2_1_0_SCHEMA];

type AtLeast<T, K extends keyof T> = Partial<T> & Pick<T, K>;

interface ExportResources {
  workspaces: AtLeast<Workspace, 'name' | 'id' | 'model'>[];
  environments: AtLeast<Environment, 'name' | 'id' | 'model' | 'workspaceId'>[];
  httpRequests: AtLeast<HttpRequest, 'name' | 'id' | 'model' | 'workspaceId'>[];
  folders: AtLeast<Folder, 'name' | 'id' | 'model' | 'workspaceId'>[];
}

export const plugin: PluginDefinition = {
  importer: {
    name: 'Postman',
    description: 'Import postman collections',
    onImport(_ctx: Context, args: { text: string }) {
      return convertPostman(args.text);
    },
  },
};

export function convertPostman(contents: string): ImportPluginResponse | undefined {
  const root = parseJSONToRecord(contents);
  if (root == null) return;

  const info = toRecord(root.info);
  const isValidSchema = VALID_SCHEMAS.includes(
    typeof info.schema === 'string' ? info.schema : 'n/a',
  );
  if (!isValidSchema || !Array.isArray(root.item)) {
    return;
  }

  const globalAuth = importAuth(root.auth);

  const exportResources: ExportResources = {
    workspaces: [],
    environments: [],
    httpRequests: [],
    folders: [],
  };

  const rawDescription = info.description;
  const description =
    typeof rawDescription === 'object' && rawDescription != null && 'content' in rawDescription
      ? String(rawDescription.content)
      : rawDescription == null
        ? undefined
        : String(rawDescription);

  const workspace: ExportResources['workspaces'][0] = {
    model: 'workspace',
    id: generateId('workspace'),
    name: info.name ? String(info.name) : 'Postman Import',
    description,
    ...globalAuth,
  };
  exportResources.workspaces.push(workspace);

  // Create the base environment
  const environment: ExportResources['environments'][0] = {
    model: 'environment',
    id: generateId('environment'),
    name: 'Global Variables',
    workspaceId: workspace.id,
    parentModel: 'workspace',
    parentId: null,
    variables:
      toArray<{ key: string; value: string }>(root.variable).map((v) => ({
        name: v.key,
        value: v.value,
      })) ?? [],
  };
  exportResources.environments.push(environment);

  let sortPriorityIndex = 0;
  const importItem = (v: Record<string, unknown>, folderId: string | null = null) => {
    if (typeof v.name === 'string' && Array.isArray(v.item)) {
      const folder: ExportResources['folders'][0] = {
        model: 'folder',
        sortPriority: sortPriorityIndex++,
        workspaceId: workspace.id,
        id: generateId('folder'),
        name: v.name,
        folderId,
      };
      exportResources.folders.push(folder);
      for (const child of v.item) {
        importItem(child, folder.id);
      }
    } else if (typeof v.name === 'string' && 'request' in v) {
      const r = toRecord(v.request);
      const bodyPatch = importBody(r.body);
      const requestAuth = importAuth(r.auth);

      const headers: HttpRequestHeader[] = toArray<{
        key: string;
        value: string;
        disabled?: boolean;
      }>(r.header).map((h) => {
        return {
          name: h.key,
          value: h.value,
          enabled: !h.disabled,
        };
      });

      // Add body headers only if they don't already exist
      for (const bodyPatchHeader of bodyPatch.headers) {
        const existingHeader = headers.find(
          (h) => h.name.toLowerCase() === bodyPatchHeader.name.toLowerCase(),
        );
        if (existingHeader) {
          continue;
        }
        headers.push(bodyPatchHeader);
      }

      const { url, urlParameters } = convertUrl(r.url);

      const request: ExportResources['httpRequests'][0] = {
        model: 'http_request',
        id: generateId('http_request'),
        workspaceId: workspace.id,
        folderId,
        name: v.name,
        description: r.description ? String(r.description) : undefined,
        method: typeof r.method === 'string' ? r.method : 'GET',
        url,
        urlParameters,
        body: bodyPatch.body,
        bodyType: bodyPatch.bodyType,
        sortPriority: sortPriorityIndex++,
        headers,
        ...requestAuth,
      };
      exportResources.httpRequests.push(request);
    } else {
      console.log('Unknown item', v, folderId);
    }
  };

  for (const item of root.item) {
    importItem(item);
  }

  const resources = deleteUndefinedAttrs(
    convertTemplateSyntax(exportResources),
  ) as PartialImportResources;

  return { resources };
}

function convertUrl(rawUrl: string | unknown): Pick<HttpRequest, 'url' | 'urlParameters'> {
  if (typeof rawUrl === 'string') {
    return { url: rawUrl, urlParameters: [] };
  }

  const url = toRecord(rawUrl);

  let v = '';

  if ('protocol' in url && typeof url.protocol === 'string') {
    v += `${url.protocol}://`;
  }

  if ('host' in url) {
    v += `${Array.isArray(url.host) ? url.host.join('.') : url.host}`;
  }

  if ('port' in url && typeof url.port === 'string') {
    v += `:${url.port}`;
  }

  if ('path' in url && Array.isArray(url.path) && url.path.length > 0) {
    v += `/${Array.isArray(url.path) ? url.path.join('/') : url.path}`;
  }

  const params: HttpUrlParameter[] = [];
  if ('query' in url && Array.isArray(url.query) && url.query.length > 0) {
    for (const query of url.query) {
      params.push({
        name: query.key ?? '',
        value: query.value ?? '',
        enabled: !query.disabled,
      });
    }
  }

  if ('variable' in url && Array.isArray(url.variable) && url.variable.length > 0) {
    for (const v of url.variable) {
      params.push({
        name: ':' + (v.key ?? ''),
        value: v.value ?? '',
        enabled: !v.disabled,
      });
    }
  }

  if ('hash' in url && typeof url.hash === 'string') {
    v += `#${url.hash}`;
  }

  // TODO: Implement url.variables (path variables)

  return { url: v, urlParameters: params };
}

function importAuth(rawAuth: unknown): Pick<HttpRequest, 'authentication' | 'authenticationType'> {
  const auth = toRecord<Record<string, string>>(rawAuth);

  // Helper: Postman stores auth params as an array of { key, value, ... }
  const pmArrayToObj = (v: unknown): Record<string, unknown> => {
    if (!Array.isArray(v)) return toRecord(v);
    const o: Record<string, unknown> = {};
    for (const i of v) {
      const ii = toRecord(i);
      if (typeof ii.key === 'string') {
        o[ii.key] = ii.value;
      }
    }
    return o;
  };

  const authType: string | undefined = auth.type ? String(auth.type) : undefined;

  if (authType === 'noauth') {
    return {
      authenticationType: 'none',
      authentication: {},
    };
  }

  if ('basic' in auth && authType === 'basic') {
    const b = pmArrayToObj(auth.basic);
    return {
      authenticationType: 'basic',
      authentication: {
        username: String(b.username ?? ''),
        password: String(b.password ?? ''),
      },
    };
  }

  if ('bearer' in auth && authType === 'bearer') {
    const b = pmArrayToObj(auth.bearer);
    // Postman uses key "token"
    return {
      authenticationType: 'bearer',
      authentication: {
        token: String(b.token ?? ''),
      },
    };
  }

  if ('awsv4' in auth && authType === 'awsv4') {
    const a = pmArrayToObj(auth.awsv4);
    return {
      authenticationType: 'awsv4',
      authentication: {
        accessKeyId: a.accessKeyId != null ? String(a.accessKeyId) : undefined,
        secretAccessKey: a.secretKey != null ? String(a.secretKey) : undefined,
        sessionToken: a.sessionToken != null ? String(a.sessionToken) : undefined,
        region: a.region != null ? String(a.region) : undefined,
        service: a.service != null ? String(a.service) : undefined,
      },
    };
  }

  if ('apikey' in auth && authType === 'apikey') {
    const a = pmArrayToObj(auth.apikey);
    return {
      authenticationType: 'apikey',
      authentication: {
        location: a.in === 'query' ? 'query' : 'header',
        key: a.value != null ? String(a.value) : undefined,
        value: a.key != null ? String(a.key) : undefined,
      },
    };
  }

  if ('jwt' in auth && authType === 'jwt') {
    const a = pmArrayToObj(auth.jwt);
    return {
      authenticationType: 'jwt',
      authentication: {
        algorithm: a.algorithm != null ? String(a.algorithm).toUpperCase() : undefined,
        secret: a.secret != null ? String(a.secret) : undefined,
        secretBase64: !!a.isSecretBase64Encoded,
        payload: a.payload != null ? String(a.payload) : undefined,
        headerPrefix: a.headerPrefix != null ? String(a.headerPrefix) : undefined,
        location: a.addTokenTo === 'header' ? 'header' : 'query',
      },
    };
  }

  if ('oauth2' in auth && authType === 'oauth2') {
    const o = pmArrayToObj(auth.oauth2);

    let grantType = o.grant_type ? String(o.grant_type) : 'authorization_code';
    let pkcePatch: Record<string, unknown> = {};

    if (grantType === 'authorization_code_with_pkce') {
      grantType = 'authorization_code';
      pkcePatch =
        o.grant_type === 'authorization_code_with_pkce'
          ? {
              usePkce: true,
              pkceChallengeMethod: o.challengeAlgorithm ?? undefined,
              pkceCodeVerifier: o.code_verifier != null ? String(o.code_verifier) : undefined,
            }
          : {};
    } else if (grantType === 'password_credentials') {
      grantType = 'password';
    }

    const accessTokenUrl = o.accessTokenUrl != null ? String(o.accessTokenUrl) : undefined;
    const audience = o.audience != null ? String(o.audience) : undefined;
    const authorizationUrl = o.authUrl != null ? String(o.authUrl) : undefined;
    const clientId = o.clientId != null ? String(o.clientId) : undefined;
    const clientSecret = o.clientSecret != null ? String(o.clientSecret) : undefined;
    const credentials = o.client_authentication === 'body' ? 'body' : undefined;
    const headerPrefix = o.headerPrefix ?? 'Bearer';
    const password = o.password != null ? String(o.password) : undefined;
    const redirectUri = o.redirect_uri != null ? String(o.redirect_uri) : undefined;
    const scope = o.scope != null ? String(o.scope) : undefined;
    const state = o.state != null ? String(o.state) : undefined;
    const username = o.username != null ? String(o.username) : undefined;

    let grantPatch: Record<string, unknown> = {};
    if (grantType === 'authorization_code') {
      grantPatch = {
        clientSecret,
        authorizationUrl,
        accessTokenUrl,
        redirectUri,
        state,
        ...pkcePatch,
      };
    } else if (grantType === 'implicit') {
      grantPatch = { authorizationUrl, redirectUri, state };
    } else if (grantType === 'password') {
      grantPatch = { clientSecret, accessTokenUrl, username, password };
    } else if (grantType === 'client_credentials') {
      grantPatch = { clientSecret, accessTokenUrl };
    }

    const authentication = {
      name: 'oauth2',
      grantType,
      audience,
      clientId,
      credentials,
      headerPrefix,
      scope,
      ...grantPatch,
    } as Record<string, unknown>;

    return { authenticationType: 'oauth2', authentication };
  }

  return { authenticationType: null, authentication: {} };
}

function importBody(rawBody: unknown): Pick<HttpRequest, 'body' | 'bodyType' | 'headers'> {
  const body = toRecord(rawBody) as {
    mode: string;
    graphql: { query?: string; variables?: string };
    urlencoded?: { key?: string; value?: string; disabled?: boolean }[];
    formdata?: {
      key?: string;
      value?: string;
      disabled?: boolean;
      contentType?: string;
      src?: string;
    }[];
    raw?: string;
    options?: { raw?: { language?: string } };
    file?: { src?: string };
  };
  if (body.mode === 'graphql') {
    return {
      headers: [
        {
          name: 'Content-Type',
          value: 'application/json',
          enabled: true,
        },
      ],
      bodyType: 'graphql',
      body: {
        text: JSON.stringify(
          {
            query: body.graphql?.query || '',
            variables: parseJSONToRecord(body.graphql?.variables || '{}'),
          },
          null,
          2,
        ),
      },
    };
  } else if (body.mode === 'urlencoded') {
    return {
      headers: [
        {
          name: 'Content-Type',
          value: 'application/x-www-form-urlencoded',
          enabled: true,
        },
      ],
      bodyType: 'application/x-www-form-urlencoded',
      body: {
        form: toArray<NonNullable<typeof body.urlencoded>[0]>(body.urlencoded).map((f) => ({
          enabled: !f.disabled,
          name: f.key ?? '',
          value: f.value ?? '',
        })),
      },
    };
  } else if (body.mode === 'formdata') {
    return {
      headers: [
        {
          name: 'Content-Type',
          value: 'multipart/form-data',
          enabled: true,
        },
      ],
      bodyType: 'multipart/form-data',
      body: {
        form: toArray<NonNullable<typeof body.formdata>[0]>(body.formdata).map((f) =>
          f.src != null
            ? {
                enabled: !f.disabled,
                contentType: f.contentType ?? null,
                name: f.key ?? '',
                file: f.src ?? '',
              }
            : {
                enabled: !f.disabled,
                name: f.key ?? '',
                value: f.value ?? '',
              },
        ),
      },
    };
  } else if (body.mode === 'raw') {
    return {
      headers: [
        {
          name: 'Content-Type',
          value: body.options?.raw?.language === 'json' ? 'application/json' : '',
          enabled: true,
        },
      ],
      bodyType: body.options?.raw?.language === 'json' ? 'application/json' : 'other',
      body: {
        text: body.raw ?? '',
      },
    };
  } else if (body.mode === 'file') {
    return {
      headers: [],
      bodyType: 'binary',
      body: {
        filePath: body.file?.src,
      },
    };
  } else {
    return { headers: [], bodyType: null, body: {} };
  }
}

function parseJSONToRecord<T>(jsonStr: string): Record<string, T> | null {
  try {
    return toRecord(JSON.parse(jsonStr));
  } catch {
    return null;
  }
}

function toRecord<T>(value: Record<string, T> | unknown): Record<string, T> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, T>;
  }
  return {};
}

function toArray<T>(value: unknown): T[] {
  if (Object.prototype.toString.call(value) === '[object Array]') return value as T[];
  else return [];
}

/** Recursively render all nested object properties */
function convertTemplateSyntax<T>(obj: T): T {
  if (typeof obj === 'string') {
    return obj.replace(
      /{{\s*(_\.)?([^}]*)\s*}}/g,
      (_m, _dot, expr) => '${[' + expr.trim().replace(/^vault:/, '') + ']}',
    ) as T;
  } else if (Array.isArray(obj) && obj != null) {
    return obj.map(convertTemplateSyntax) as T;
  } else if (typeof obj === 'object' && obj != null) {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, convertTemplateSyntax(v)]),
    ) as T;
  } else {
    return obj;
  }
}

function deleteUndefinedAttrs<T>(obj: T): T {
  if (Array.isArray(obj) && obj != null) {
    return obj.map(deleteUndefinedAttrs) as T;
  } else if (typeof obj === 'object' && obj != null) {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, deleteUndefinedAttrs(v)]),
    ) as T;
  } else {
    return obj;
  }
}

const idCount: Partial<Record<string, number>> = {};

function generateId(model: string): string {
  idCount[model] = (idCount[model] ?? -1) + 1;
  return `GENERATE_ID::${model.toUpperCase()}_${idCount[model]}`;
}
