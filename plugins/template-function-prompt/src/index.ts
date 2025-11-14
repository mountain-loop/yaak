import type { CallTemplateFunctionArgs, Context, PluginDefinition } from '@yaakapp/api';
import slugify from 'slugify';

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
        { type: 'text', name: 'label', label: 'Label' },
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
          type: 'h_stack',
          dynamic(_ctx, args) {
            return { hidden: args.values.store === STORE_NONE };
          },
          inputs: [
            {
              type: 'text',
              name: 'namespace',
              label: 'Namespace',
              defaultValue: '${[ctx.workspace()]}',
              optional: true,
            },
            {
              type: 'text',
              name: 'key',
              label: 'Key (defaults to Label)',
              optional: true,
              dynamic(_ctx, args) {
                return { placeholder: String(args.values.label || '') };
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
          type: 'banner',
          color: 'info',
          dynamic(_ctx, args) {
            return { hidden: args.values.store === STORE_NONE };
          },
          inputs: [
            {
              type: 'markdown',
              content: '',
              async dynamic(_ctx, args) {
                const key = buildKey(args);
                return {
                  content: ['Value will be saved under: `' + key + '`'].join('\n\n'),
                };
              },
            },
          ],
        },
        {
          type: 'accordion',
          label: 'Advanced',
          inputs: [
            {
              type: 'text',
              name: 'title',
              label: 'Prompt Title',
              optional: true,
              placeholder: 'Enter Value',
            },
            { type: 'text', name: 'defaultValue', label: 'Default Value', optional: true },
            { type: 'text', name: 'placeholder', label: 'Input Placeholder', optional: true },
            { type: 'checkbox', name: 'password', label: 'Mask Value' },
          ],
        },
      ],
      async onRender(ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        if (args.purpose !== 'send') return null;
        const existing = await maybeGetValue(ctx, args);
        if (existing != null) {
          return existing;
        }

        const value = await ctx.prompt.text({
          id: `prompt-${args.values.label ?? 'none'}`,
          label: String(args.values.label || 'Value'),
          title: String(args.values.title ?? 'Enter Value'),
          defaultValue: String(args.values.defaultValue ?? ''),
          placeholder: String(args.values.placeholder ?? ''),
          password: Boolean(args.values.password),
          required: false,
        });

        if (value == null) {
          throw new Error('Prompt cancelled');
        }

        if (args.values.store !== STORE_NONE) {
          await maybeSetValue(ctx, args, value);
        }

        return value;
      },
    },
  ],
};

function buildKey(args: CallTemplateFunctionArgs) {
  return [args.values.namespace, args.values.key || args.values.label]
    .filter((v) => !!v)
    .map((v) => slugify(String(v), { lower: true, trim: true }))
    .join('.');
}

async function maybeGetValue(ctx: Context, args: CallTemplateFunctionArgs) {
  if (args.values.store === STORE_NONE) return null;

  const existing = await ctx.store.get<Saved>(buildKey(args));
  if (existing == null) {
    return null;
  }

  if (args.values.store === STORE_FOREVER) {
    return existing.value;
  }

  const ttlSeconds = parseInt(String(args.values.ttl)) || 0;
  const ageSeconds = (Date.now() - existing.createdAt) / 1000;
  if (ageSeconds > ttlSeconds) {
    ctx.store.delete(buildKey(args)).catch(console.error);
    return null;
  }

  return existing.value;
}

async function maybeSetValue(ctx: Context, args: CallTemplateFunctionArgs, value: string) {
  if (args.values.store === STORE_NONE) return;
  if (!args.values.namespace) {
    throw new Error('Namespace is required for storing prompt value');
  }
  await ctx.store.set<Saved>(buildKey(args), { value, createdAt: Date.now() });
}
