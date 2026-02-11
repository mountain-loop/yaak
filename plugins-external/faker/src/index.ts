import { faker } from '@faker-js/faker';
import type { DynamicTemplateFunctionArg, PluginDefinition } from '@yaakapp/api';

const modules = [
  'airline',
  'animal',
  'color',
  'commerce',
  'company',
  'database',
  'date',
  'finance',
  'git',
  'hacker',
  'image',
  'internet',
  'location',
  'lorem',
  'person',
  'music',
  'number',
  'phone',
  'science',
  'string',
  'system',
  'vehicle',
  'word',
];

function normalizeResult(result: unknown): string {
  if (typeof result === 'string') return result;
  return JSON.stringify(result);
}

// Whatever Yaak’s arg type shape is – rough example
function args(modName: string, fnName: string): DynamicTemplateFunctionArg[] {
  return [
    {
      type: 'banner',
      color: 'info',
      inputs: [
        {
          type: 'markdown',
          content: `Need help? View documentation for [\`${modName}.${fnName}(…)\`](https://fakerjs.dev/api/${encodeURIComponent(modName)}.html#${encodeURIComponent(fnName)})`,
        },
      ],
    },
    {
      name: 'options',
      label: 'Arguments',
      type: 'editor',
      language: 'json',
      optional: true,
      placeholder: 'e.g. { "min": 1, "max": 10 } or 10 or ["en","US"]',
    },
  ];
}

export const plugin: PluginDefinition = {
  templateFunctions: modules.flatMap((modName) => {
    const mod = faker[modName as keyof typeof faker];
    return Object.keys(mod)
      .filter((n) => n !== 'faker')
      .map((fnName) => ({
        name: ['faker', modName, fnName].join('.'),
        args: args(modName, fnName),
        async onRender(_ctx, args) {
          const fn = mod[fnName as keyof typeof mod] as (...a: unknown[]) => unknown;
          const options = args.values.options;

          // No options supplied
          if (options == null || options === '') {
            return normalizeResult(fn());
          }

          // Try JSON first
          let parsed: unknown = options;
          if (typeof options === 'string') {
            try {
              parsed = JSON.parse(options);
            } catch {
              // Not valid JSON – maybe just a scalar
              const n = Number(options);
              if (!Number.isNaN(n)) {
                parsed = n;
              } else {
                parsed = options;
              }
            }
          }

          let result: unknown;
          if (Array.isArray(parsed)) {
            // Treat as positional arguments
            result = fn(...parsed);
          } else {
            // Treat as a single argument (option object or scalar)
            result = fn(parsed);
          }

          return normalizeResult(result);
        },
      }));
  }),
};
