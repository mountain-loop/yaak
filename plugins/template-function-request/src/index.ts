import type { AnyModel, HttpUrlParameter } from '@yaakapp-internal/models';
import type { CallTemplateFunctionArgs, Context, PluginDefinition } from '@yaakapp/api';

export const plugin: PluginDefinition = {
  templateFunctions: [
    {
      name: 'request.body',
      args: [
        {
          name: 'requestId',
          label: 'Http Request',
          type: 'http_request',
        },
      ],
      async onRender(ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        const requestId = String(args.values.requestId ?? 'n/a');
        const httpRequest = await ctx.httpRequest.getById({ id: requestId });
        if (httpRequest == null) return null;
        return String(
          await ctx.templates.render({
            data: httpRequest.body?.text ?? '',
            purpose: args.purpose,
          }),
        );
      },
    },
    {
      name: 'request.header',
      args: [
        {
          name: 'requestId',
          label: 'Http Request',
          type: 'http_request',
        },
        {
          name: 'header',
          label: 'Header Name',
          type: 'text',
        },
      ],
      async onRender(ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        const headerName = String(args.values.header ?? '');
        const requestId = String(args.values.requestId ?? 'n/a');
        const httpRequest = await ctx.httpRequest.getById({ id: requestId });
        if (httpRequest == null) return null;
        const header = httpRequest.headers.find(
          (h) => h.name.toLowerCase() === headerName.toLowerCase(),
        );
        return String(
          await ctx.templates.render({
            data: header?.value ?? '',
            purpose: args.purpose,
          }),
        );
      },
    },
    {
      name: 'request.param',
      args: [
        {
          name: 'requestId',
          label: 'Http Request',
          type: 'http_request',
        },
        {
          name: 'param',
          label: 'Param Name',
          type: 'text',
        },
      ],
      async onRender(ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        const paramName = String(args.values.param ?? '');
        const requestId = String(args.values.requestId ?? 'n/a');
        const httpRequest = await ctx.httpRequest.getById({ id: requestId });
        if (httpRequest == null) return null;

        const renderedUrl = await ctx.templates.render({
          data: httpRequest.url,
          purpose: args.purpose,
        });

        const querystring = renderedUrl.split('?')[1] ?? '';
        const paramsFromUrl: HttpUrlParameter[] = new URLSearchParams(querystring)
          .entries()
          .map(([name, value]): HttpUrlParameter => ({ name, value }))
          .toArray();

        const allParams = [...paramsFromUrl, ...httpRequest.urlParameters];
        const allEnabledParams = allParams.filter((p) => p.enabled !== false);
        const foundParam = allEnabledParams.find((p) => p.name === paramName);

        const renderedValue = await ctx.templates.render({
          data: foundParam?.value ?? '',
          purpose: args.purpose,
        });
        return renderedValue;
      },
    },
    {
      name: 'request.name',
      args: [
        {
          name: 'requestId',
          label: 'Http Request',
          type: 'http_request',
        },
      ],
      async onRender(ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        const requestId = String(args.values.requestId ?? 'n/a');
        const httpRequest = await ctx.httpRequest.getById({ id: requestId });
        if (httpRequest == null) return null;

        return resolvedModelName(httpRequest);
      },
    },
  ],
};

// TODO: Use a common function for this, but it fails to build on windows during CI if I try importing it here
export function resolvedModelName(r: AnyModel | null): string {
  if (r == null) return '';

  if (!('url' in r) || r.model === 'plugin') {
    return 'name' in r ? r.name : '';
  }

  // Return name if it has one
  if ('name' in r && r.name) {
    return r.name;
  }

  // Replace variable syntax with variable name
  const withoutVariables = r.url.replace(/\$\{\[\s*([^\]\s]+)\s*]}/g, '$1');
  if (withoutVariables.trim() === '') {
    return r.model === 'http_request'
      ? r.bodyType && r.bodyType === 'graphql'
        ? 'GraphQL Request'
        : 'HTTP Request'
      : r.model === 'websocket_request'
        ? 'WebSocket Request'
        : 'gRPC Request';
  }

  // GRPC gets nice short names
  if (r.model === 'grpc_request' && r.service != null && r.method != null) {
    const shortService = r.service.split('.').pop();
    return `${shortService}/${r.method}`;
  }

  // Strip unnecessary protocol
  const withoutProto = withoutVariables.replace(/^(http|https|ws|wss):\/\//, '');

  return withoutProto;
}
