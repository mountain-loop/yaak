import type { JSONPathResult } from '../template-function-json';
import { filterJSONPath } from '../template-function-json';
import type { XPathResult } from '../template-function-xml';
import { filterXPath } from '../template-function-xml';
import type {
  CallTemplateFunctionArgs,
  Context,
  DynamicTemplateFunctionArg,
  FormInput,
  HttpResponse,
  PluginDefinition,
  RenderPurpose,
} from '@yaakapp/api';
import { readFileSync } from 'node:fs';

const BEHAVIOR_TTL = 'ttl';
const BEHAVIOR_ALWAYS = 'always';
const BEHAVIOR_SMART = 'smart';

const RETURN_FIRST = 'first';
const RETURN_ALL = 'all';
const RETURN_JOIN = 'join';

const behaviorArgs: DynamicTemplateFunctionArg = {
  type: 'h_stack',
  inputs: [
    {
      type: 'select',
      name: 'behavior',
      label: 'Sending Behavior',
      defaultValue: BEHAVIOR_SMART,
      options: [
        { label: 'When no responses', value: BEHAVIOR_SMART },
        { label: 'Always', value: BEHAVIOR_ALWAYS },
        { label: 'When expired', value: BEHAVIOR_TTL },
      ],
    },
    {
      type: 'text',
      name: 'ttl',
      label: 'TTL (seconds)',
      placeholder: '0',
      defaultValue: '0',
      description:
        'Resend the request when the latest response is older than this many seconds, or if there are no responses yet. "0" means never expires',
      dynamic(_ctx, args) {
        return { hidden: args.values.behavior !== BEHAVIOR_TTL };
      },
    },
  ],
};

const requestArg: FormInput = {
  type: 'http_request',
  name: 'request',
  label: 'Request',
};

export const plugin: PluginDefinition = {
  templateFunctions: [
    {
      name: 'response.header',
      description: 'Read the value of a response header, by name',
      args: [
        requestArg,
        behaviorArgs,
        {
          type: 'text',
          name: 'header',
          label: 'Header Name',
          placeholder: 'Content-Type',
        },
      ],
      async onRender(ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        if (!args.values.request || !args.values.header) return null;

        const response = await getResponse(ctx, {
          requestId: String(args.values.request || ''),
          purpose: args.purpose,
          behavior: args.values.behavior ? String(args.values.behavior) : null,
          ttl: String(args.values.ttl || ''),
        });
        if (response == null) return null;

        const header = response.headers.find(
          (h) => h.name.toLowerCase() === String(args.values.header ?? '').toLowerCase(),
        );
        return header?.value ?? null;
      },
    },
    {
      name: 'response.body.path',
      description: 'Access a field of the response body using JsonPath or XPath',
      aliases: ['response'],
      args: [
        requestArg,
        behaviorArgs,
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
            const resp = await getResponse(ctx, {
              requestId: String(args.values.request || ''),
              purpose: 'preview',
              behavior: args.values.behavior ? String(args.values.behavior) : null,
              ttl: String(args.values.ttl || ''),
            });

            if (resp == null) {
              return null;
            }

            const contentType =
              resp?.headers.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? '';
            if (contentType.includes('xml') || contentType?.includes('html')) {
              return {
                label: 'XPath',
                placeholder: '/books[0]/id',
                description: 'Enter an XPath expression used to filter the results',
              };
            } else {
              return {
                label: 'JSONPath',
                placeholder: '$.books[0].id',
                description: 'Enter a JSONPath expression used to filter the results',
              };
            }
          },
        },
      ],
      async onRender(ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        if (!args.values.request || !args.values.path) return null;

        const response = await getResponse(ctx, {
          requestId: String(args.values.request || ''),
          purpose: args.purpose,
          behavior: args.values.behavior ? String(args.values.behavior) : null,
          ttl: String(args.values.ttl || ''),
        });
        if (response == null) return null;

        if (response.bodyPath == null) {
          return null;
        }

        let body;
        try {
          body = readFileSync(response.bodyPath, 'utf-8');
        } catch {
          return null;
        }

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
      name: 'response.body.raw',
      description: 'Access the entire response body, as text',
      aliases: ['response'],
      args: [requestArg, behaviorArgs],
      async onRender(ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        if (!args.values.request) return null;

        const response = await getResponse(ctx, {
          requestId: String(args.values.request || ''),
          purpose: args.purpose,
          behavior: args.values.behavior ? String(args.values.behavior) : null,
          ttl: String(args.values.ttl || ''),
        });
        if (response == null) return null;

        if (response.bodyPath == null) {
          return null;
        }

        let body;
        try {
          body = readFileSync(response.bodyPath, 'utf-8');
        } catch {
          return null;
        }

        return body;
      },
    },
  ],
};

async function getResponse(
  ctx: Context,
  {
    requestId,
    behavior,
    purpose,
    ttl,
  }: {
    requestId: string;
    behavior: string | null;
    ttl: string | null;
    purpose: RenderPurpose;
  },
): Promise<HttpResponse | null> {
  if (!requestId) return null;

  const httpRequest = await ctx.httpRequest.getById({ id: requestId ?? 'n/a' });
  if (httpRequest == null) {
    return null;
  }

  const responses = await ctx.httpResponse.find({ requestId: httpRequest.id, limit: 1 });

  if (behavior === 'never' && responses.length === 0) {
    return null;
  }

  let response: HttpResponse | null = responses[0] ?? null;

  // Previews happen a ton, and we don't want to send too many times on "always," so treat
  // it as "smart" during preview.
  const finalBehavior = behavior === 'always' && purpose === 'preview' ? 'smart' : behavior;

  // Send if no responses and "smart," or "always"
  if (
    (finalBehavior === 'smart' && response == null) ||
    finalBehavior === 'always' ||
    (finalBehavior === BEHAVIOR_TTL && shouldSendExpired(response, ttl))
  ) {
    // NOTE: Render inside this conditional, or we'll get infinite recursion (render->render->...)
    const renderedHttpRequest = await ctx.httpRequest.render({ httpRequest, purpose });
    response = await ctx.httpRequest.send({ httpRequest: renderedHttpRequest });
  }

  return response;
}

function shouldSendExpired(response: HttpResponse | null, ttl: string | null): boolean {
  if (response == null) return true;
  const ttlSeconds = parseInt(ttl || '0') || 0;
  if (ttlSeconds === 0) return false;
  const nowMillis = Date.now();
  const respMillis = new Date(response.createdAt + 'Z').getTime();
  return respMillis + ttlSeconds * 1000 < nowMillis;
}
