import { CallTemplateFunctionArgs, Context, PluginDefinition } from '@yaakapp/api';
import { JSONPath } from 'jsonpath-plus';

export const plugin: PluginDefinition = {
  templateFunctions: [
    {
      name: 'json.jsonpath',
      description: 'Filter JSON-formatted text using JSONPath syntax',
      args: [
        { type: 'text', name: 'input', label: 'Input', multiLine: true, placeholder: '{ "foo": "bar" }' },
        { type: 'text', name: 'query', label: 'Query', placeholder: '$..foo' },
        { type: 'checkbox', name: 'formatted', label: 'Format Output' },
      ],
      async onRender(_ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        try {
          const parsed = JSON.parse(String(args.values.input));
          const query = String(args.values.query ?? '$').trim();
          let filtered = JSONPath({ path: query, json: parsed });
          if (Array.isArray(filtered)) {
            filtered = filtered[0];
          }
          if (typeof filtered === 'string') {
            return filtered;
          }

          if (args.values.formatted) {
            return JSON.stringify(filtered, null, 2);
          } else {
            return JSON.stringify(filtered);
          }
        } catch (e) {
          return null;
        }
      },
    },
    {
      name: 'json.escape',
      description: 'Escape a JSON string, useful when using the output in JSON values',
      args: [
        { type: 'text', name: 'input', label: 'Input', multiLine: true, placeholder: 'Hello "World"' },
      ],
      async onRender(_ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        const input = String(args.values.input ?? '');
        return input.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      },
    },
  ],
};
