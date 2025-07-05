import type { CallTemplateFunctionArgs, Context, PluginDefinition } from '@yaakapp/api';

export const plugin: PluginDefinition = {
  templateFunctions: [{
    name: 'prompt.text',
    description: 'Prompt the user for input when sending a request',
    args: [
      { type: 'text', name: 'title', label: 'Title' },
      { type: 'text', name: 'label', label: 'Label', optional: true },
      { type: 'text', name: 'defaultValue', label: 'Default Value', optional: true },
      { type: 'text', name: 'placeholder', label: 'Placeholder', optional: true },
    ],
    async onRender(ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
      if (args.purpose !== 'send') return null;

      return await ctx.prompt.text({
        id: `prompt-${args.values.label}`,
        label: String(args.values.title ?? ''),
        title: String(args.values.title ?? ''),
        defaultValue: String(args.values.defaultValue),
        placeholder: String(args.values.placeholder),
      });
    },
  }],
};
