import { CallTemplateFunctionArgs, Context, PluginDefinition } from '@yaakapp/api';

export const plugin: PluginDefinition = {
  templateFunctions: [
    {
      name: 'request.body',
      args: [{
        name: 'requestId',
        label: 'Http Request',
        type: 'http_request',
      }],
      async onRender(ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        const httpRequest = await ctx.httpRequest.getById({ id: args.values.requestId ?? 'n/a' });
        if (httpRequest == null) return null;
        return String(await ctx.templates.render({
          data: httpRequest.body?.text ?? '',
          purpose: args.purpose,
        }));
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
        }],
      async onRender(ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        const httpRequest = await ctx.httpRequest.getById({ id: args.values.requestId ?? 'n/a' });
        if (httpRequest == null) return null;
        const header = httpRequest.headers.find(h => h.name.toLowerCase() === args.values.header?.toLowerCase());
        return String(await ctx.templates.render({
          data: header?.value ?? '',
          purpose: args.purpose,
        }));
      },
    },
  ],
};
