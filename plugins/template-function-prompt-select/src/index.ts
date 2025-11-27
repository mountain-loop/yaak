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
      name: 'prompt.select',
      description: 'Prompt the user to select from a list of options when sending a request',
      previewType: 'click',
      args: [
        { type: 'text', name: 'label', label: 'Label', optional: true },
        {
          type: 'text',
          name: 'options',
          label: 'Options (JSON array)',
          placeholder: '["option1", "option2", "option3"]',
        },
        { type: 'text', name: 'defaultValue', label: 'Default Value', optional: true },
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
              // biome-ignore lint/suspicious/noTemplateCurlyInString: Yaak template syntax
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
                  content: [`Value will be saved under: \`${key}\``].join('\n\n'),
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
              placeholder: 'Select an option',
            },
          ],
        },
      ],
      async onRender(ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        if (args.purpose !== 'send') return null;

        if (args.values.store !== STORE_NONE && !args.values.namespace) {
          throw new Error('Namespace is required when storing values');
        }

        const existing = await maybeGetValue(ctx, args);
        if (existing != null) {
          return existing;
        }

        // Parse JSON array options
        const optionsStr = String(args.values.options ?? '');
        let parsedOptions: unknown;
        try {
          parsedOptions = JSON.parse(optionsStr);
        } catch (e) {
          throw new Error(`Invalid JSON in options: ${e instanceof Error ? e.message : String(e)}`);
        }

        if (!Array.isArray(parsedOptions)) {
          throw new Error('Options must be a JSON array');
        }

        if (parsedOptions.length === 0) {
          throw new Error('At least one option is required');
        }

        // Create options array for the select prompt
        // Support both string arrays ["opt1", "opt2"] and object arrays [{"label": "...", "value": "..."}]
        const options = parsedOptions.map((opt) => {
          if (typeof opt === 'string') {
            return { label: opt, value: opt };
          }
          if (typeof opt === 'object' && opt !== null && 'label' in opt && 'value' in opt) {
            return { label: String(opt.label), value: String(opt.value) };
          }
          throw new Error('Each option must be a string or an object with "label" and "value" properties');
        });

        const firstValue = typeof parsedOptions[0] === 'string' ? parsedOptions[0] : (parsedOptions[0] as { value: string }).value;

        const value = await ctx.prompt.select({
          id: `prompt-select-${args.values.label ?? 'none'}`,
          label: String(args.values.label || 'Select an option'),
          title: String(args.values.title ?? 'Select an option'),
          defaultValue: String(args.values.defaultValue ?? firstValue),
          options,
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
  if (!args.values.key && !args.values.label) {
    throw new Error('Key or Label is required when storing values');
  }
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

  const ttlSeconds = Number.parseInt(String(args.values.ttl), 10) || 0;
  const ageSeconds = (Date.now() - existing.createdAt) / 1000;
  if (ageSeconds > ttlSeconds) {
    ctx.store.delete(buildKey(args)).catch(console.error);
    return null;
  }

  return existing.value;
}

async function maybeSetValue(ctx: Context, args: CallTemplateFunctionArgs, value: string) {
  if (args.values.store === STORE_NONE) {
    return;
  }

  await ctx.store.set<Saved>(buildKey(args), { value, createdAt: Date.now() });
}
