import { Context, Environment, Folder, HttpRequest, HttpUrlParameter, PluginDefinition, Workspace } from '@yaakapp/api';
import { ControlOperator, parse, ParseEntry } from 'shell-quote';

type AtLeast<T, K extends keyof T> = Partial<T> & Pick<T, K>;

interface ExportResources {
  workspaces: AtLeast<Workspace, 'name' | 'id' | 'model'>[];
  environments: AtLeast<Environment, 'name' | 'id' | 'model' | 'workspaceId'>[];
  httpRequests: AtLeast<HttpRequest, 'name' | 'id' | 'model' | 'workspaceId'>[];
  folders: AtLeast<Folder, 'name' | 'id' | 'model' | 'workspaceId'>[];
}

const DATA_FLAGS = ['d', 'data', 'data-raw', 'data-urlencode', 'data-binary', 'data-ascii'];
const SUPPORTED_FLAGS = [
  ['cookie', 'b'],
  ['d', 'data'], // Add url encoded data
  ['data-ascii'],
  ['data-binary'],
  ['data-raw'],
  ['data-urlencode'],
  ['digest'], // Apply auth as digest
  ['form', 'F'], // Add multipart data
  ['get', 'G'], // Put the post data in the URL
  ['header', 'H'],
  ['request', 'X'], // Request method
  ['url'], // Specify the URL explicitly
  ['url-query'],
  ['user', 'u'], // Authentication
  DATA_FLAGS,
].flatMap((v) => v);

const BOOLEAN_FLAGS = ['G', 'get', 'digest'];

type FlagValue = string | boolean;

type FlagsByName = Record<string, FlagValue[]>;

export const plugin: PluginDefinition = {
  importer: {
    name: 'cURL',
    description: 'Import cURL commands',
    onImport(_ctx: Context, args: { text: string }) {
      return convertCurl(args.text) as any;
    },
  },
};

export function convertCurl(rawData: string) {
  if (!rawData.match(/^\s*curl /)) {
    return null;
  }

  const commands: ParseEntry[][] = [];

  // Replace non-escaped newlines with semicolons to make parsing easier
  // NOTE: This is really slow in debug build but fast in release mode
  const normalizedData = rawData.replace(/\ncurl/g, '; curl');

  let currentCommand: ParseEntry[] = [];

  const parsed = parse(normalizedData);

  // Break up `-XPOST` into `-X POST`
  const normalizedParseEntries = parsed.flatMap((entry) => {
    if (
      typeof entry === 'string' &&
      entry.startsWith('-') &&
      !entry.startsWith('--') &&
      entry.length > 2
    ) {
      return [entry.slice(0, 2), entry.slice(2)];
    }
    return entry;
  });

  for (const parseEntry of normalizedParseEntries) {
    if (typeof parseEntry === 'string') {
      if (parseEntry.startsWith('$')) {
        currentCommand.push(parseEntry.slice(1));
      } else {
        currentCommand.push(parseEntry);
      }
      continue;
    }

    if ('comment' in parseEntry) {
      continue;
    }

    const { op } = parseEntry as { op: 'glob'; pattern: string } | { op: ControlOperator };

    // `;` separates commands
    if (op === ';') {
      commands.push(currentCommand);
      currentCommand = [];
      continue;
    }

    if (op?.startsWith('$')) {
      // Handle the case where literal like -H $'Header: \'Some Quoted Thing\''
      const str = op.slice(2, op.length - 1).replace(/\\'/g, '\'');

      currentCommand.push(str);
      continue;
    }

    if (op === 'glob') {
      currentCommand.push((parseEntry as { op: 'glob'; pattern: string }).pattern);
    }
  }

  commands.push(currentCommand);

  const workspace: ExportResources['workspaces'][0] = {
    model: 'workspace',
    id: generateId('workspace'),
    name: 'Curl Import',
  };

  const requests: ExportResources['httpRequests'] = commands
    .filter((command) => command[0] === 'curl')
    .map((v) => importCommand(v, workspace.id));

  return {
    resources: {
      httpRequests: requests,
      workspaces: [workspace],
    },
  };
}

function importCommand(parseEntries: ParseEntry[], workspaceId: string) {
  // ~~~~~~~~~~~~~~~~~~~~~ //
  // Collect all the flags //
  // ~~~~~~~~~~~~~~~~~~~~~ //
  const flagsByName: FlagsByName = {};
  const singletons: ParseEntry[] = [];

  // Start at 1 so we can skip the ^curl part
  for (let i = 1; i < parseEntries.length; i++) {
    let parseEntry = parseEntries[i];
    if (typeof parseEntry === 'string') {
      parseEntry = parseEntry.trim();
    }

    if (typeof parseEntry === 'string' && parseEntry.match(/^-{1,2}[\w-]+/)) {
      const isSingleDash = parseEntry[0] === '-' && parseEntry[1] !== '-';
      let name = parseEntry.replace(/^-{1,2}/, '');

      if (!SUPPORTED_FLAGS.includes(name)) {
        continue;
      }

      let value;
      const nextEntry = parseEntries[i + 1];
      const hasValue = !BOOLEAN_FLAGS.includes(name);
      if (isSingleDash && name.length > 1) {
        // Handle squished arguments like -XPOST
        value = name.slice(1);
        name = name.slice(0, 1);
      } else if (typeof nextEntry === 'string' && hasValue && !nextEntry.startsWith('-')) {
        // Next arg is not a flag, so assign it as the value
        value = nextEntry;
        i++; // Skip next one
      } else {
        value = true;
      }

      flagsByName[name] = flagsByName[name] || [];
      flagsByName[name]!.push(value);
    } else if (parseEntry) {
      singletons.push(parseEntry);
    }
  }

  // ~~~~~~~~~~~~~~~~~ //
  // Build the request //
  // ~~~~~~~~~~~~~~~~~ //

  // Url and Parameters
  let urlParameters: HttpUrlParameter[];
  let url: string;

  const urlArg = getPairValue(flagsByName, (singletons[0] as string) || '', ['url']);
  const [baseUrl, search] = splitOnce(urlArg, '?');
  urlParameters =
    search?.split('&').map((p) => {
      const v = splitOnce(p, '=');
      return { name: decodeURIComponent(v[0] ?? ''), value: decodeURIComponent(v[1] ?? ''), enabled: true };
    }) ?? [];

  url = baseUrl ?? urlArg;

  // Query params
  for (const p of flagsByName['url-query'] ?? []) {
    if (typeof p !== 'string') {
      continue;
    }
    const [name, value] = p.split('=');
    urlParameters.push({
      name: name ?? '',
      value: value ?? '',
      enabled: true,
    });
  }

  // Authentication
  const [username, password] = getPairValue(flagsByName, '', ['u', 'user']).split(/:(.*)$/);

  const isDigest = getPairValue(flagsByName, false, ['digest']);
  const authenticationType = username ? (isDigest ? 'digest' : 'basic') : null;
  const authentication = username
    ? {
      username: username.trim(),
      password: (password ?? '').trim(),
    }
    : {};

  // Headers
  const headers = [
    ...((flagsByName['header'] as string[] | undefined) || []),
    ...((flagsByName['H'] as string[] | undefined) || []),
  ].map((header) => {
    const [name, value] = header.split(/:(.*)$/);
    // remove final colon from header name if present
    if (!value) {
      return {
        name: (name ?? '').trim().replace(/;$/, ''),
        value: '',
        enabled: true,
      };
    }
    return {
      name: (name ?? '').trim(),
      value: value.trim(),
      enabled: true,
    };
  });

  // Cookies
  const cookieHeaderValue = [
    ...((flagsByName['cookie'] as string[] | undefined) || []),
    ...((flagsByName['b'] as string[] | undefined) || []),
  ]
    .map((str) => {
      const name = str.split('=', 1)[0];
      const value = str.replace(`${name}=`, '');
      return `${name}=${value}`;
    })
    .join('; ');

  // Convert cookie value to header
  const existingCookieHeader = headers.find((header) => header.name.toLowerCase() === 'cookie');

  if (cookieHeaderValue && existingCookieHeader) {
    // Has existing cookie header, so let's update it
    existingCookieHeader.value += `; ${cookieHeaderValue}`;
  } else if (cookieHeaderValue) {
    // No existing cookie header, so let's make a new one
    headers.push({
      name: 'Cookie',
      value: cookieHeaderValue,
      enabled: true,
    });
  }

  // Body (Text or Blob)
  const dataParameters = pairsToDataParameters(flagsByName);
  const contentTypeHeader = headers.find((header) => header.name.toLowerCase() === 'content-type');
  const mimeType = contentTypeHeader ? contentTypeHeader.value.split(';')[0] : null;

  // Body (Multipart Form Data)
  const formDataParams = [
    ...((flagsByName['form'] as string[] | undefined) || []),
    ...((flagsByName['F'] as string[] | undefined) || []),
  ].map((str) => {
    const parts = str.split('=');
    const name = parts[0] ?? '';
    const value = parts[1] ?? '';
    const item: { name: string; value?: string; file?: string; enabled: boolean } = {
      name,
      enabled: true,
    };

    if (value.indexOf('@') === 0) {
      item['file'] = value.slice(1);
    } else {
      item['value'] = value;
    }

    return item;
  });

  // Body
  let body = {};
  let bodyType: string | null = null;
  const bodyAsGET = getPairValue(flagsByName, false, ['G', 'get']);

  if (dataParameters.length > 0 && bodyAsGET) {
    urlParameters.push(...dataParameters);
  } else if (
    dataParameters.length > 0 &&
    (mimeType == null || mimeType === 'application/x-www-form-urlencoded')
  ) {
    bodyType = mimeType ?? 'application/x-www-form-urlencoded';
    body = {
      form: dataParameters.map((parameter) => ({
        ...parameter,
        name: decodeURIComponent(parameter.name || ''),
        value: decodeURIComponent(parameter.value || ''),
      })),
    };
    headers.push({
      name: 'Content-Type',
      value: 'application/x-www-form-urlencoded',
      enabled: true,
    });
  } else if (dataParameters.length > 0) {
    bodyType =
      mimeType === 'application/json' || mimeType === 'text/xml' || mimeType === 'text/plain'
        ? mimeType
        : 'other';
    body = {
      text: dataParameters
        .map(({ name, value }) => (name && value ? `${name}=${value}` : name || value))
        .join('&'),
    };
  } else if (formDataParams.length) {
    bodyType = mimeType ?? 'multipart/form-data';
    body = {
      form: formDataParams,
    };
    if (mimeType == null) {
      headers.push({
        name: 'Content-Type',
        value: 'multipart/form-data',
        enabled: true,
      });
    }
  }

  // Method
  let method = getPairValue(flagsByName, '', ['X', 'request']).toUpperCase();

  if (method === '' && body) {
    method = 'text' in body || 'form' in body ? 'POST' : 'GET';
  }

  const request: ExportResources['httpRequests'][0] = {
    id: generateId('http_request'),
    model: 'http_request',
    workspaceId,
    name: '',
    urlParameters,
    url,
    method,
    headers,
    authentication,
    authenticationType,
    body,
    bodyType,
    folderId: null,
    sortPriority: 0,
  };

  return request;
}

interface DataParameter {
  name: string;
  value: string;
  contentType?: string;
  filePath?: string;
  enabled?: boolean;
}

function pairsToDataParameters(keyedPairs: FlagsByName): DataParameter[] {
  let dataParameters: DataParameter[] = [];

  for (const flagName of DATA_FLAGS) {
    const pairs = keyedPairs[flagName];

    if (!pairs || pairs.length === 0) {
      continue;
    }

    for (const p of pairs) {
      if (typeof p !== 'string') continue;
      let params = p.split("&");
      for (const param of params) {
        const [name, value] = param.split('=');
        if (param.startsWith('@')) {
          // Yaak doesn't support files in url-encoded data, so
          dataParameters.push({
            name: name ?? '',
            value: '',
            filePath: param.slice(1),
            enabled: true,
          });
        } else {
          dataParameters.push({
            name: name ?? '',
            value: flagName === 'data-urlencode' ? encodeURIComponent(value ?? '') : value ?? '',
            enabled: true,
          });
        }
      }
    }
  }

  return dataParameters;
}

const getPairValue = <T extends string | boolean>(
  pairsByName: FlagsByName,
  defaultValue: T,
  names: string[],
) => {
  for (const name of names) {
    if (pairsByName[name] && pairsByName[name]!.length) {
      return pairsByName[name]![0] as T;
    }
  }

  return defaultValue;
};

function splitOnce(str: string, sep: string): string[] {
  const index = str.indexOf(sep);
  if (index > -1) {
    return [str.slice(0, index), str.slice(index + 1)];
  }
  return [str];
}

const idCount: Partial<Record<string, number>> = {};

function generateId(model: string): string {
  idCount[model] = (idCount[model] ?? -1) + 1;
  return `GENERATE_ID::${model.toUpperCase()}_${idCount[model]}`;
}
