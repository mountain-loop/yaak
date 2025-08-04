import type { HttpRequest, PluginDefinition } from '@yaakapp/api';

const NEWLINE = '\\\n ';

export const plugin: PluginDefinition = {
  httpRequestActions: [
    {
      label: 'Copy as Curl',
      icon: 'copy',
      async onSelect(ctx, args) {
        const rendered_request = await ctx.httpRequest.render({
          httpRequest: args.httpRequest,
          purpose: 'preview',
        });
        const data = await convertToCurl(rendered_request);
        await ctx.clipboard.copyText(data);
        await ctx.toast.show({
          message: 'Command copied to clipboard',
          icon: 'copy',
          color: 'success',
        });
      },
    },
  ],
};

export async function convertToCurl(request: Partial<HttpRequest>) {
  const xs = ['curl'];

  // Add method and URL all on first line
  if (request.method) xs.push('-X', request.method);

  // Build final URL with parameters (compatible with old curl)
  let finalUrl = request.url || '';
  const urlParams = (request.urlParameters ?? []).filter(onlyEnabled);
  if (urlParams.length > 0) {
    // Build url
    const [base, hash] = finalUrl.split('#');
    const separator = base!.includes('?') ? '&' : '?';
    const queryString = urlParams
      .map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`)
      .join('&');
    finalUrl = base + separator + queryString + (hash ? `#${hash}` : '');
  }

  xs.push(quote(finalUrl));
  xs.push(NEWLINE);

  // Add headers
  for (const h of (request.headers ?? []).filter(onlyEnabled)) {
    xs.push('--header', quote(`${h.name}: ${h.value}`));
    xs.push(NEWLINE);
  }

  // Add form params
  const type = request.bodyType ?? 'none';
  if (
    (type === 'multipart/form-data' || type === 'application/x-www-form-urlencoded') &&
    Array.isArray(request.body?.form)
  ) {
    const flag = request.bodyType === 'multipart/form-data' ? '--form' : '--data';
    for (const p of (request.body?.form ?? []).filter(onlyEnabled)) {
      if (p.file) {
        let v = `${p.name}=@${p.file}`;
        v += p.contentType ? `;type=${p.contentType}` : '';
        xs.push(flag, v);
      } else {
        xs.push(flag, quote(`${p.name}=${p.value}`));
      }
      xs.push(NEWLINE);
    }
  } else if (type === 'graphql' && typeof request.body?.query === 'string') {
    const body = {
      query: request.body.query || '',
      variables: maybeParseJSON(request.body.variables, undefined),
    };
    xs.push('--data', quote(JSON.stringify(body)));
    xs.push(NEWLINE);
  } else if (type !== 'none' && typeof request.body?.text === 'string') {
    xs.push('--data', quote(request.body.text));
    xs.push(NEWLINE);
  }

  // Add basic/digest authentication
  if (request.authenticationType === 'basic' || request.authenticationType === 'digest') {
    if (request.authenticationType === 'digest') xs.push('--digest');
    xs.push(
      '--user',
      quote(`${request.authentication?.username ?? ''}:${request.authentication?.password ?? ''}`),
    );
    xs.push(NEWLINE);
  }

  // Add bearer authentication
  if (request.authenticationType === 'bearer') {
    xs.push('--header', quote(`Authorization: Bearer ${request.authentication?.token ?? ''}`));
    xs.push(NEWLINE);
  }

  // Remove trailing newline
  if (xs[xs.length - 1] === NEWLINE) {
    xs.splice(xs.length - 1, 1);
  }

  return xs.join(' ');
}

function quote(arg: string): string {
  const escaped = arg.replace(/'/g, "\\'");
  return `'${escaped}'`;
}

function onlyEnabled(v: { name?: string; enabled?: boolean }): boolean {
  return v.enabled !== false && !!v.name;
}

function maybeParseJSON<T>(v: string, fallback: T) {
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}
