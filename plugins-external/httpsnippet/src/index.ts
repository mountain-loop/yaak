import { type HarRequest, availableTargets, HTTPSnippet } from '@readme/httpsnippet';
import type { EditorLanguage, HttpRequest, PluginDefinition } from '@yaakapp/api';

// Get all available targets and build select options
const targets = availableTargets();

// Targets to exclude from the language list
const excludedTargets = new Set(['json']);

// Build language (target) options
const languageOptions = targets
  .filter((target) => !excludedTargets.has(target.key))
  .map((target) => ({
    label: target.title,
    value: target.key,
  }));

// Preferred clients per target (shown first in the list)
const preferredClients: Record<string, string> = {
  javascript: 'fetch',
  node: 'fetch',
};

// Get client options for a given target key
function getClientOptions(targetKey: string) {
  const target = targets.find((t) => t.key === targetKey);
  if (!target) return [];
  const preferred = preferredClients[targetKey];
  return target.clients
    .map((client) => ({
      label: client.title,
      value: client.key,
    }))
    .sort((a, b) => {
      if (a.value === preferred) return -1;
      if (b.value === preferred) return 1;
      return 0;
    });
}

// Get default client for a target
function getDefaultClient(targetKey: string): string {
  const options = getClientOptions(targetKey);
  return options[0]?.value ?? '';
}

// Defaults
const defaultTarget = 'javascript';
const defaultClient = 'fetch';

// Map httpsnippet target key to editor language for syntax highlighting
const editorLanguageMap: Record<string, EditorLanguage> = {
  c: 'c',
  clojure: 'clojure',
  csharp: 'csharp',
  go: 'go',
  http: 'http',
  java: 'java',
  javascript: 'javascript',
  kotlin: 'kotlin',
  node: 'javascript',
  objc: 'objective_c',
  ocaml: 'ocaml',
  php: 'php',
  powershell: 'powershell',
  python: 'python',
  r: 'r',
  ruby: 'ruby',
  shell: 'shell',
  swift: 'swift',
};

function getEditorLanguage(targetKey: string): EditorLanguage {
  return editorLanguageMap[targetKey] ?? 'text';
}

// Convert Yaak HttpRequest to HAR format
function toHarRequest(request: Partial<HttpRequest>) {
  // Build URL with query parameters
  let finalUrl = request.url || '';
  const urlParams = (request.urlParameters ?? []).filter((p) => p.enabled !== false && !!p.name);
  if (urlParams.length > 0) {
    const [base, hash] = finalUrl.split('#');
    const separator = base?.includes('?') ? '&' : '?';
    const queryString = urlParams
      .map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`)
      .join('&');
    finalUrl = base + separator + queryString + (hash ? `#${hash}` : '');
  }

  // Build headers array
  const headers: Array<{ name: string; value: string }> = (request.headers ?? [])
    .filter((h) => h.enabled !== false && !!h.name)
    .map((h) => ({ name: h.name, value: h.value }));

  // Handle authentication
  if (request.authentication?.disabled !== true) {
    if (request.authenticationType === 'basic') {
      const credentials = btoa(
        `${request.authentication?.username ?? ''}:${request.authentication?.password ?? ''}`,
      );
      headers.push({ name: 'Authorization', value: `Basic ${credentials}` });
    } else if (request.authenticationType === 'bearer') {
      const prefix = request.authentication?.prefix ?? 'Bearer';
      const token = request.authentication?.token ?? '';
      headers.push({ name: 'Authorization', value: `${prefix} ${token}`.trim() });
    } else if (request.authenticationType === 'apikey') {
      if (request.authentication?.location === 'header') {
        headers.push({
          name: request.authentication?.key ?? 'X-Api-Key',
          value: request.authentication?.value ?? '',
        });
      } else if (request.authentication?.location === 'query') {
        const sep = finalUrl.includes('?') ? '&' : '?';
        finalUrl = [
          finalUrl,
          sep,
          encodeURIComponent(request.authentication?.key ?? 'token'),
          '=',
          encodeURIComponent(request.authentication?.value ?? ''),
        ].join('');
      }
    }
  }

  // Build HAR request object
  const har: Record<string, unknown> = {
    method: request.method || 'GET',
    url: finalUrl,
    headers,
  };

  // Handle request body
  const bodyType = request.bodyType ?? 'none';
  if (bodyType !== 'none' && request.body) {
    if (bodyType === 'application/x-www-form-urlencoded' && Array.isArray(request.body.form)) {
      const params = request.body.form
        .filter((p: { enabled?: boolean; name?: string }) => p.enabled !== false && !!p.name)
        .map((p: { name: string; value: string }) => ({ name: p.name, value: p.value }));
      har.postData = {
        mimeType: 'application/x-www-form-urlencoded',
        params,
      };
    } else if (bodyType === 'multipart/form-data' && Array.isArray(request.body.form)) {
      const params = request.body.form
        .filter((p: { enabled?: boolean; name?: string }) => p.enabled !== false && !!p.name)
        .map((p: { name: string; value: string; file?: string; contentType?: string }) => {
          const param: Record<string, string> = { name: p.name, value: p.value || '' };
          if (p.file) param.fileName = p.file;
          if (p.contentType) param.contentType = p.contentType;
          return param;
        });
      har.postData = {
        mimeType: 'multipart/form-data',
        params,
      };
    } else if (bodyType === 'graphql' && typeof request.body.query === 'string') {
      const body = {
        query: request.body.query || '',
        variables: maybeParseJSON(request.body.variables, undefined),
      };
      har.postData = {
        mimeType: 'application/json',
        text: JSON.stringify(body),
      };
    } else if (typeof request.body.text === 'string') {
      har.postData = {
        mimeType: bodyType,
        text: request.body.text,
      };
    }
  }

  return har;
}

function maybeParseJSON<T>(v: unknown, fallback: T): T | unknown {
  if (typeof v !== 'string') return fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

export const plugin: PluginDefinition = {
  httpRequestActions: [
    {
      label: 'Generate Code Snippet',
      icon: 'copy',
      async onSelect(ctx, args) {
        // Render the request with variables resolved
        const renderedRequest = await ctx.httpRequest.render({
          httpRequest: args.httpRequest,
          purpose: 'send',
        });

        // Convert to HAR format
        const harRequest = toHarRequest(renderedRequest) as HarRequest;

        // Get previously selected language or use defaults
        const storedTarget = await ctx.store.get<string>('selectedTarget');
        const storedClient = await ctx.store.get<string>('selectedClient');
        const initialTarget = storedTarget || defaultTarget;
        const initialClient = storedClient || defaultClient;

        // Create snippet generator
        const snippet = new HTTPSnippet(harRequest);
        const generateSnippet = (target: string, client: string): string => {
          const result = snippet.convert(target as any, client);
          return (Array.isArray(result) ? result.join('\n') : result || '').replace(/\r\n/g, '\n');
        };

        // Generate initial code preview
        let initialCode = '';
        try {
          initialCode = generateSnippet(initialTarget, initialClient);
        } catch {
          initialCode = '// Error generating snippet';
        }

        // Show dialog with language/library selectors and code preview
        const result = await ctx.prompt.form({
          id: 'httpsnippet',
          title: 'Generate Code Snippet',
          confirmText: 'Copy to Clipboard',
          cancelText: 'Cancel',
          size: 'md',
          inputs: [
            {
              type: 'h_stack',
              inputs: [
                {
                  type: 'select',
                  name: 'target',
                  label: 'Language',
                  defaultValue: initialTarget,
                  options: languageOptions,
                },
                {
                  type: 'select',
                  name: `client-${initialTarget}`,
                  label: 'Library',
                  defaultValue: initialClient,
                  options: getClientOptions(initialTarget),
                  dynamic(_ctx, { values }) {
                    const targetKey = String(values.target || defaultTarget);
                    const options = getClientOptions(targetKey);
                    return {
                      name: `client-${targetKey}`,
                      options,
                      defaultValue: options[0]?.value ?? '',
                    };
                  },
                },
              ],
            },
            {
              type: 'editor',
              name: 'code',
              label: 'Preview',
              language: getEditorLanguage(initialTarget),
              defaultValue: initialCode,
              readOnly: true,
              rows: 15,
              dynamic(_ctx, { values }) {
                const targetKey = String(values.target || defaultTarget);
                const clientKey = String(
                  values[`client-${targetKey}`] || getDefaultClient(targetKey),
                );
                let code: string;
                try {
                  code = generateSnippet(targetKey, clientKey);
                } catch {
                  code = '// Error generating snippet';
                }
                return {
                  defaultValue: code,
                  language: getEditorLanguage(targetKey),
                };
              },
            },
          ],
        });

        if (result) {
          // Store the selected language and library for next time
          const selectedTarget = String(result.target || initialTarget);
          const selectedClient = String(
            result[`client-${selectedTarget}`] || getDefaultClient(selectedTarget),
          );
          await ctx.store.set('selectedTarget', selectedTarget);
          await ctx.store.set('selectedClient', selectedClient);

          // Generate snippet for the selected language
          try {
            const codeText = generateSnippet(selectedTarget, selectedClient);
            await ctx.clipboard.copyText(codeText);
            await ctx.toast.show({
              message: 'Code snippet copied to clipboard',
              icon: 'copy',
              color: 'success',
            });
          } catch (err) {
            await ctx.toast.show({
              message: `Failed to generate snippet: ${err}`,
              icon: 'alert_triangle',
              color: 'danger',
            });
          }
        }
      },
    },
  ],
};
