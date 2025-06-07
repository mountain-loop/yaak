import { CallTemplateFunctionArgs, Context, PluginDefinition } from '@yaakapp/api';

export const plugin: PluginDefinition = {
  templateFunctions: [
    {
      name: 'cookie.value',
      description: 'Read the value of a cookie in the jar, by name',
      args: [
        {
          type: 'text',
          name: 'cookie_name',
          label: 'Cookie Name',
        },
      ],
      async onRender(ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        return ctx.cookies.getValue({ name: String(args.values.cookie_name) });
      },
    },
  ],
};
