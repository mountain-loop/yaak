import { CallTemplateFunctionArgs, Context, PluginDefinition } from '@yaakapp/api';

export const plugin: PluginDefinition = {
  templateFunctions: [{
    name: 'regex.match',
    description: 'Extract',
    args: [
      {
        type: 'text',
        name: 'regex',
        label: 'Regular Expression',
        placeholder: '^\w+=(?<value>\w*)$',
        defaultValue: '^(.*)$',
        description: 'A JavaScript regular expression, evaluated using the Node.js RegExp engine. Capture groups or named groups can be used to extract values.',
      },
      { type: 'text', name: 'input', label: 'Input Text', multiLine: true },
    ],
    async onRender(_ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
      if (!args.values.regex) return '';

      const regex = new RegExp(String(args.values.regex));
      const match = args.values.input?.match(regex);
      return match?.groups
        ? Object.values(match.groups)[0] ?? ''
        : match?.[1] ?? match?.[0] ?? '';
    },
  }],
};
