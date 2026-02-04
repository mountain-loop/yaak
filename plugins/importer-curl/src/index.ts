import type {
  Context,
  Environment,
  Folder,
  HttpRequest,
  HttpUrlParameter,
  PluginDefinition,
  Workspace,
} from '@yaakapp/api';
import type { ControlOperator, ParseEntry } from 'shell-quote';
import { parse } from 'shell-quote';

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
].flat();

const BOOLEAN_FLAGS = ['G', 'get', 'digest'];

type FlagValue = string | boolean;

type FlagsByName = Record<string, FlagValue[]>;

export const plugin: PluginDefinition = {
  importer: {
    name: 'cURL',
    description: 'Import cURL commands',
    onImport(_ctx: Context, args: { text: string }) {
      // biome-ignore lint/suspicious/noExplicitAny: none
      return convertCurl(args.text) as any;
    },
  },
};

/**
 * Decodes escape sequences in shell $'...' strings
 * Handles Unicode escape sequences (\uXXXX) and common escape codes
 */
function decodeShellString(str: string): string {
  return str
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/**
 * Checks if a string might contain escape sequences that need decoding
 * If so, decodes them; otherwise returns the string as-is
 */
function maybeDecodeEscapeSequences(str: string): string {
  // Check if the string contains escape sequences that shell-quote might not handle
  if (str.includes('\\u') || str.includes('\\x')) {
    return decodeShellString(str);
  }
  return str;
}

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
        // Handle $'...' strings from shell-quote - decode escape sequences
        currentCommand.push(decodeShellString(parseEntry.slice(1)));
      } else {
        // Decode escape sequences that shell-quote might not handle
        currentCommand.push(maybeDecodeEscapeSequences(parseEntry));
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
      const str = decodeShellString(op.slice(2, op.length - 1));

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

      let value: string | boolean;
      const nextEntry = parseEntries[i + 1];
      const hasValue = !BOOLEAN_FLAGS.includes(name);
      // Check if nextEntry looks like a flag:
      // - Single dash followed by a letter: -X, -H, -d
      // - Double dash followed by a letter: --data-raw, --header
      // This prevents mistaking data that starts with dashes (like multipart boundaries ------) as flags
      const nextEntryIsFlag =
        typeof nextEntry === 'string' &&
        (nextEntry.match(/^-[a-zA-Z]/) || nextEntry.match(/^--[a-zA-Z]/));
      if (isSingleDash && name.length > 1) {
        // Handle squished arguments like -XPOST
        value = name.slice(1);
        name = name.slice(0, 1);
      } else if (typeof nextEntry === 'string' && hasValue && !nextEntryIsFlag) {
        // Next arg is not a flag, so assign it as the value
        value = nextEntry;
        i++; // Skip next one
      } else {
        value = true;
      }

      flagsByName[name] = flagsByName[name] || [];
      flagsByName[name]?.push(value);
    } else if (parseEntry) {
      singletons.push(parseEntry);
    }
  }

  // ~~~~~~~~~~~~~~~~~ //
  // Build the request //
  // ~~~~~~~~~~~~~~~~~ //

  const urlArg = getPairValue(flagsByName, (singletons[0] as string) || '', ['url']);
  const [baseUrl, search] = splitOnce(urlArg, '?');
  const urlParameters: HttpUrlParameter[] =
    search?.split('&').map((p) => {
      const v = splitOnce(p, '=');
      return {
        name: decodeURIComponent(v[0] ?? ''),
        value: decodeURIComponent(v[1] ?? ''),
        enabled: true,
      };
    }) ?? [];

  const url = baseUrl ?? urlArg;

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
    ...((flagsByName.header as string[] | undefined) || []),
    ...((flagsByName.H as string[] | undefined) || []),
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
    ...((flagsByName.cookie as string[] | undefined) || []),
    ...((flagsByName.b as string[] | undefined) || []),
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
  const contentTypeHeader = headers.find((header) => header.name.toLowerCase() === 'content-type');
  const mimeType = contentTypeHeader ? contentTypeHeader.value.split(';')[0]?.trim() : null;

  // Extract boundary from Content-Type header for multipart parsing
  const boundaryMatch = contentTypeHeader?.value.match(/boundary=([^\s;]+)/i);
  const boundary = boundaryMatch?.[1];

  // Get raw data from --data-raw flags (before splitting by &)
  const rawDataValues = [
    ...((flagsByName['data-raw'] as string[] | undefined) || []),
    ...((flagsByName.d as string[] | undefined) || []),
    ...((flagsByName.data as string[] | undefined) || []),
    ...((flagsByName['data-binary'] as string[] | undefined) || []),
    ...((flagsByName['data-ascii'] as string[] | undefined) || []),
  ];

  // Check if this is multipart form data in --data-raw (Chrome DevTools format)
  let multipartFormDataFromRaw:
    | { name: string; value?: string; file?: string; enabled: boolean }[]
    | null = null;
  if (mimeType === 'multipart/form-data' && boundary && rawDataValues.length > 0) {
    const rawBody = rawDataValues.join('');
    multipartFormDataFromRaw = parseMultipartFormData(rawBody, boundary);
  }

  const dataParameters = pairsToDataParameters(flagsByName);

  // Body (Multipart Form Data from -F flags)
  const formDataParams = [
    ...((flagsByName.form as string[] | undefined) || []),
    ...((flagsByName.F as string[] | undefined) || []),
  ].map((str) => {
    const parts = str.split('=');
    const name = parts[0] ?? '';
    const value = parts[1] ?? '';
    const item: { name: string; value?: string; file?: string; enabled: boolean } = {
      name,
      enabled: true,
    };

    if (value.indexOf('@') === 0) {
      item.file = value.slice(1);
    } else {
      item.value = value;
    }

    return item;
  });

  // Body
  let body = {};
  let bodyType: string | null = null;
  const bodyAsGET = getPairValue(flagsByName, false, ['G', 'get']);

  if (multipartFormDataFromRaw) {
    // Handle multipart form data parsed from --data-raw (Chrome DevTools format)
    bodyType = 'multipart/form-data';
    body = {
      form: multipartFormDataFromRaw,
    };
  } else if (dataParameters.length > 0 && bodyAsGET) {
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
  const dataParameters: DataParameter[] = [];

  for (const flagName of DATA_FLAGS) {
    const pairs = keyedPairs[flagName];

    if (!pairs || pairs.length === 0) {
      continue;
    }

    for (const p of pairs) {
      if (typeof p !== 'string') continue;
      const params = p.split('&');
      for (const param of params) {
        const [name, value] = splitOnce(param, '=');
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
            value: flagName === 'data-urlencode' ? encodeURIComponent(value ?? '') : (value ?? ''),
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
    if (pairsByName[name]?.length) {
      return pairsByName[name]?.[0] as T;
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

/**
 * Parses multipart form data from a raw body string
 * Used when Chrome DevTools exports a cURL with --data-raw containing multipart data
 */
function parseMultipartFormData(
  rawBody: string,
  boundary: string,
): { name: string; value?: string; file?: string; enabled: boolean }[] | null {
  const results: { name: string; value?: string; file?: string; enabled: boolean }[] = [];

  // The boundary in the body typically has -- prefix
  const boundaryMarker = `--${boundary}`;
  const parts = rawBody.split(boundaryMarker);

  for (const part of parts) {
    // Skip empty parts and the closing boundary marker
    if (!part || part.trim() === '--' || part.trim() === '--\r\n') {
      continue;
    }

    // Each part has headers and content separated by \r\n\r\n
    const headerContentSplit = part.indexOf('\r\n\r\n');
    if (headerContentSplit === -1) {
      continue;
    }

    const headerSection = part.slice(0, headerContentSplit);
    let content = part.slice(headerContentSplit + 4); // Skip \r\n\r\n

    // Remove trailing \r\n from content
    if (content.endsWith('\r\n')) {
      content = content.slice(0, -2);
    }

    // Parse Content-Disposition header to get name and filename
    const contentDispositionMatch = headerSection.match(
      /Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]+)")?/i,
    );

    if (!contentDispositionMatch) {
      continue;
    }

    const name = contentDispositionMatch[1] ?? '';
    const filename = contentDispositionMatch[2];

    const item: { name: string; value?: string; file?: string; enabled: boolean } = {
      name,
      enabled: true,
    };

    if (filename) {
      // This is a file upload field
      item.file = filename;
    } else {
      // This is a regular text field
      item.value = content;
    }

    results.push(item);
  }

  return results.length > 0 ? results : null;
}

const idCount: Partial<Record<string, number>> = {};

function generateId(model: string): string {
  idCount[model] = (idCount[model] ?? -1) + 1;
  return `GENERATE_ID::${model.toUpperCase()}_${idCount[model]}`;
}
