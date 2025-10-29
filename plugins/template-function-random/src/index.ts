import type { CallTemplateFunctionArgs, Context, PluginDefinition } from '@yaakapp/api';

export const plugin: PluginDefinition = {
  templateFunctions: [
    {
      name: 'random.range',
      description: 'Generate a random number between two values',
      args: [
        {
          type: 'text',
          name: 'min',
          label: 'Minimum',
          defaultValue: '0',
        },
        {
          type: 'text',
          name: 'max',
          label: 'Maximum',
          defaultValue: '1',
        },
        {
          type: 'text',
          name: 'decimals',
          optional: true,
          label: 'Decimal Places',
        },
      ],
      async onRender(_ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        const min = args.values.min ? parseInt(String(args.values.min ?? '0')) : 0;
        const max = args.values.max ? parseInt(String(args.values.max ?? '1')) : 1;
        const decimals = args.values.decimals
          ? parseInt(String(args.values.decimals ?? '0'))
          : null;

        let value = Math.random() * (max - min) + min;
        if (decimals !== null) {
          value = Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
        }
        return String(value);
      },
    },
  ],
};
