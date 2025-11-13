import type { CallTemplateFunctionArgs, Context, PluginDefinition } from '@yaakapp/api';

const STORE_NONE = 'none';
const STORE_FOREVER = 'forever';
const STORE_EXPIRE = 'expire';

interface Saved {
  value: string;
  createdAt: number;
}

export const plugin: PluginDefinition = {
  templateFunctions: [
    {
      name: 'prompt.text',
      description: 'Prompt the user for input when sending a request',
      previewType: 'click',
      args: [
        {
          type: 'text',
          name: 'title',
          label: 'Title',
          optional: true,
          defaultValue: 'Enter Value',
        },
        {
          type: 'h_stack',
          inputs: [
            {
              type: 'select',
              name: 'store',
              label: 'Store Input',
              defaultValue: STORE_NONE,
              options: [
                { label: 'Never', value: STORE_NONE },
                { label: 'Expire', value: STORE_EXPIRE },
                { label: 'Forever', value: STORE_FOREVER },
              ],
            },
            {
              type: 'text',
              name: 'storageKey',
              label: 'Storage Key',
              defaultValue: '${[ctx.workspace()]}',
              optional: true,
              description:
                'Unique key to store the value under. Can be a template function like ctx.environment()',
              dynamic(_ctx, args) {
                return { hidden: args.values.store === STORE_NONE };
              },
            },
            {
              type: 'text',
              name: 'ttl',
              label: 'TTL (seconds)',
              placeholder: '0',
              defaultValue: '0',
              optional: true,
              dynamic(_ctx, args) {
                return { hidden: args.values.store !== STORE_EXPIRE };
              },
            },
          ],
        },
        {
          type: 'accordion',
          label: 'Advanced',
          inputs: [
            { type: 'text', name: 'defaultValue', label: 'Default Value', optional: true },
            { type: 'text', name: 'label', label: 'Label', optional: true },
            { type: 'text', name: 'placeholder', label: 'Placeholder', optional: true },
          ],
        },
      ],
      async onRender(ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        if (args.values.store !== STORE_NONE && !args.values.storageKey) {
          throw new Error('Storage key is required for storing prompt value');
        }

        const ttlSeconds = parseInt(String(args.values.ttl)) || 0;

        const key = ['prompt', args.values.storageKey].join('.');
        const existing = args.values.store === STORE_NONE ? null : await ctx.store.get<Saved>(key);

        if (existing != null) {
          if (args.values.store === STORE_FOREVER) {
            return existing.value;
          }

          const ageSeconds = (Date.now() - existing.createdAt) / 1000;
          const expired = ageSeconds > ttlSeconds;
          if (args.values.store === STORE_EXPIRE && !expired) {
            return existing.value;
          }
        }

        const value = await ctx.prompt.text({
          id: `prompt-${args.values.label ?? 'none'}`,
          label: String(args.values.label || 'Value'),
          title: String(args.values.title ?? 'Enter Value'),
          defaultValue: String(args.values.defaultValue ?? ''),
          placeholder: String(args.values.placeholder ?? ''),
          required: false,
        });

        if (value == null) {
          throw new Error('Prompt cancelled');
        }

        if (args.values.store !== STORE_NONE) {
          await ctx.store.set<Saved>(key, { value, createdAt: Date.now() });
        }

        return value;
      },
    },
  ],
};
