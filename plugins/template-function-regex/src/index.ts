import type { CallTemplateFunctionArgs, Context, PluginDefinition } from '@yaakapp/api';
import type { TemplateFunctionArg } from '@yaakapp-internal/plugins';

const inputArg: TemplateFunctionArg = {
  type: 'text',
  name: 'input',
  label: 'Input Text',
  multiLine: true,
};

const regexArg: TemplateFunctionArg = {
  type: 'text',
  name: 'regex',
  label: 'Regular Expression',
  placeholder: '\\w+',
  defaultValue: '.*',
  description:
    'A JavaScript regular expression. Use a capture group to reference parts of the match in the replacement.',
};

export const plugin: PluginDefinition = {
  templateFunctions: [
    {
      name: 'regex.match',
      description: 'Extract text using a regular expression',
      args: [inputArg, regexArg],
      async onRender(_ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        const input = String(args.values.input ?? '');
        const regex = new RegExp(String(args.values.regex ?? ''));

        const match = input.match(regex);
        return match?.groups
          ? (Object.values(match.groups)[0] ?? '')
          : (match?.[1] ?? match?.[0] ?? '');
      },
    },
    {
      name: 'regex.replace',
      description: 'Replace text using a regular expression',
      args: [
        inputArg,
        regexArg,
        {
          type: 'text',
          name: 'replacement',
          label: 'Replacement Text',
          placeholder: 'hello $1',
          description:
            'The replacement text. Use $1, $2, ... to reference capture groups or $& to reference the entire match.',
        },
        {
          type: 'text',
          name: 'flags',
          label: 'Flags',
          placeholder: 'g',
          defaultValue: 'g',
          optional: true,
          description:
            'Regular expression flags (g for global, i for case-insensitive, m for multiline, etc.)',
        },
      ],
      async onRender(_ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        const input = String(args.values.input ?? '');
        const replacement = String(args.values.replacement ?? '');
        const flags = String(args.values.flags || '');
        const regex = String(args.values.regex);

        if (!regex) return '';

        return input.replace(new RegExp(String(args.values.regex), flags), replacement);
      },
    },
  ],
};
