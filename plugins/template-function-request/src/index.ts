import type { CallTemplateFunctionArgs, Context, PluginDefinition } from '@yaakapp/api';
import type { AnyModel, HttpUrlParameter } from '@yaakapp-internal/models';
import type { GenericCompletionOption } from '@yaakapp-internal/plugins';
import type { JSONPathResult } from '../../template-function-json';
import { filterJSONPath } from '../../template-function-json';
import type { XPathResult } from '../../template-function-xml';
import { filterXPath } from '../../template-function-xml';

const RETURN_FIRST = 'first';
const RETURN_ALL = 'all';
const RETURN_JOIN = 'join';

export const plugin: PluginDefinition = {
  templateFunctions: [
    {
      name: 'request.body.raw',
      aliases: ['request.body'],
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
      name: 'request.body.path',
      previewArgs: ['path'],
      args: [
        { name: 'requestId', label: 'Http Request', type: 'http_request' },
        {
          type: 'h_stack',
          inputs: [
            {
              type: 'select',
              name: 'result',
              label: 'Return Format',
              defaultValue: RETURN_FIRST,
              options: [
                { label: 'First result', value: RETURN_FIRST },
                { label: 'All results', value: RETURN_ALL },
                { label: 'Join with separator', value: RETURN_JOIN },
              ],
            },
            {
              name: 'join',
              type: 'text',
              label: 'Separator',
              optional: true,
              defaultValue: ', ',
              dynamic(_ctx, args) {
                return { hidden: args.values.result !== RETURN_JOIN };
              },
            },
          ],
        },
        {
          type: 'text',
          name: 'path',
          label: 'JSONPath or XPath',
          placeholder: '$.books[0].id or /books[0]/id',
          dynamic: async (ctx, args) => {
            const requestId = String(args.values.requestId ?? 'n/a');
            const httpRequest = await ctx.httpRequest.getById({ id: requestId });
            if (httpRequest == null) return null;

            const contentType =
              httpRequest.headers
                .find((h) => h.name.toLowerCase() === 'content-type')
                ?.value.toLowerCase() ?? '';
            if (contentType.includes('xml') || contentType?.includes('html')) {
              return {
                label: 'XPath',
                placeholder: '/books[0]/id',
                description: 'Enter an XPath expression used to filter the results',
              };
            }

            return {
              label: 'JSONPath',
              placeholder: '$.books[0].id',
              description: 'Enter a JSONPath expression used to filter the results',
            };
          },
        },
      ],
      async onRender(ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        const requestId = String(args.values.requestId ?? 'n/a');
        const httpRequest = await ctx.httpRequest.getById({ id: requestId });
        if (httpRequest == null) return null;

        const body = httpRequest.body?.text ?? '';

        try {
          const result: JSONPathResult =
            args.values.result === RETURN_ALL
              ? 'all'
              : args.values.result === RETURN_JOIN
                ? 'join'
                : 'first';
          return filterJSONPath(
            body,
            String(args.values.path || ''),
            result,
            args.values.join == null ? null : String(args.values.join),
          );
        } catch {
          // Probably not JSON, try XPath
        }

        try {
          const result: XPathResult =
            args.values.result === RETURN_ALL
              ? 'all'
              : args.values.result === RETURN_JOIN
                ? 'join'
                : 'first';
          return filterXPath(
            body,
            String(args.values.path || ''),
            result,
            args.values.join == null ? null : String(args.values.join),
          );
        } catch {
          // Probably not XML
        }

        return null; // Bail out
      },
    },
    {
      name: 'request.header',
      description: 'Read the value of a request header, by name',
      previewArgs: ['header'],
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
          async dynamic(ctx, args) {
            if (typeof args.values.requestId !== 'string') return null;

            const request = await ctx.httpRequest.getById({ id: args.values.requestId });
            if (request == null) return null;

            const validHeaders = request.headers.filter((h) => h.enabled !== false && h.name);
            return {
              placeholder: validHeaders[0]?.name,
              completionOptions: validHeaders.map<GenericCompletionOption>((h) => ({
                label: h.name,
                type: 'constant',
              })),
            };
          },
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
