import { CallTemplateFunctionArgs, Context, PluginDefinition } from '@yaakapp/api';

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
        label: args.values.title ?? '',
        title: args.values.title ?? '',
        defaultValue: args.values.defaultValue,
        placeholder: args.values.placeholder,
      });
    },
  }],
};
