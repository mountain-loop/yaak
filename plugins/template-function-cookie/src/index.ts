import type { CallTemplateFunctionArgs, Context, PluginDefinition } from '@yaakapp/api';

export const plugin: PluginDefinition = {
  templateFunctions: [
    {
      name: 'cookie.value',
      description: 'Read the value of a cookie in the jar, by name',
      previewArgs: ['name'],
      args: [
        {
          type: 'text',
          name: 'name',
          label: 'Cookie Name',
        },
      ],
      async onRender(ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        // The legacy name was cookie_name, but we changed it
        const name = args.values.cookie_name ?? args.values.name;
        return ctx.cookies.getValue({ name: String(name) });
      },
    },
  ],
};
