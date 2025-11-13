import type { XPathResult } from '@yaak/template-function-xml';
import type { CallTemplateFunctionArgs, Context, PluginDefinition } from '@yaakapp/api';
import { JSONPath } from 'jsonpath-plus';

const RETURN_FIRST = 'first';
const RETURN_ALL = 'all';
const RETURN_JOIN = 'join';

export const plugin: PluginDefinition = {
  templateFunctions: [
    {
      name: 'json.jsonpath',
      description: 'Filter JSON-formatted text using JSONPath syntax',
      args: [
        {
          type: 'editor',
          name: 'input',
          label: 'Input',
          language: 'json',
          placeholder: '{ "foo": "bar" }',
        },
        {
          type: 'h_stack',
          inputs: [
            {
              type: 'select',
              name: 'result',
              label: 'Return Format',
              defaultValue: RETURN_FIRST,
              options: [
                { label: 'First result', value: RETURN_FIRST },
                { label: 'All results', value: RETURN_ALL },
                { label: 'Join with separator', value: RETURN_JOIN },
              ],
            },
            {
              name: 'join',
              type: 'text',
              label: 'Separator',
              optional: true,
              defaultValue: ', ',
              dynamic(_ctx, args) {
                return { hidden: args.values.result !== RETURN_JOIN };
              },
            },
          ],
        },
        {
          type: 'checkbox',
          name: 'formatted',
          label: 'Pretty Print',
          description: 'Format the output as JSON',
          dynamic(_ctx, args) {
            return { hidden: args.values.result === RETURN_JOIN };
          },
        },
        { type: 'text', name: 'query', label: 'Query', placeholder: '$..foo' },
      ],
      async onRender(_ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        try {
          return filterJSONPath(
            String(args.values.input),
            String(args.values.query),
            (args.values.result || RETURN_FIRST) as XPathResult,
            args.values.join == null ? null : String(args.values.join),
            Boolean(args.values.formatted),
          );
        } catch {
          return null;
        }
      },
    },
    {
      name: 'json.escape',
      description: 'Escape a JSON string, useful when using the output in JSON values',
      args: [
        {
          type: 'text',
          name: 'input',
          label: 'Input',
          multiLine: true,
          placeholder: 'Hello "World"',
        },
      ],
      async onRender(_ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        const input = String(args.values.input ?? '');
        return input.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      },
    },
    {
      name: 'json.minify',
      description: 'Remove unnecessary whitespace from a valid JSON string.',
      args: [
        {
          type: 'editor',
          language: 'json',
          name: 'input',
          label: 'Input',
          placeholder: '{ "foo": "bar" }',
        },
      ],
      async onRender(_ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        const input = String(args.values.input ?? '');
        try {
          return JSON.stringify(JSON.parse(input));
        } catch {
          return input;
        }
      },
    },
  ],
};

export type JSONPathResult = 'first' | 'join' | 'all';

export function filterJSONPath(
  body: string,
  path: string,
  result: JSONPathResult,
  join: string | null,
  formatted: boolean = false,
): string {
  const parsed = JSON.parse(body);
  let items = JSONPath({ path, json: parsed });

  if (items == null) {
    return '';
  }

  if (!Array.isArray(items)) {
    // Already good
  } else if (result === 'first') {
    items = items[0] ?? '';
  } else if (result === 'join') {
    items = items.map((i) => objToStr(i, false)).join(join ?? '');
  }

  return objToStr(items, formatted);
}

function objToStr(o: unknown, formatted: boolean = false): string {
  if (
    Object.prototype.toString.call(o) === '[object Array]' ||
    Object.prototype.toString.call(o) === '[object Object]'
  ) {
    return formatted ? JSON.stringify(o, null, 2) : JSON.stringify(o);
  } else {
    return String(o);
  }
}
