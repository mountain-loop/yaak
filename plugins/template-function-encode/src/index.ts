import { CallTemplateFunctionArgs, Context, PluginDefinition } from '@yaakapp/api';

export const plugin: PluginDefinition = {
  templateFunctions: [
    {
      name: 'base64.encode',
      description: 'Encode a value to base64',
      args: [{ label: 'Plain Text', type: 'text', name: 'value', multiLine: true }],
      async onRender(_ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        return Buffer.from(args.values.value ?? '').toString('base64');
      },
    },
    {
      name: 'base64.decode',
      description: 'Decode a value from base64',
      args: [{ label: 'Encoded Value', type: 'text', name: 'value', multiLine: true }],
      async onRender(_ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        return Buffer.from(args.values.value ?? '', 'base64').toString('utf-8');
      },
    },
    {
      name: 'url.encode',
      description: 'Encode a value for use in a URL (percent-encoding)',
      args: [{ label: 'Plain Text', type: 'text', name: 'value', multiLine: true }],
      async onRender(_ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        return encodeURIComponent(args.values.value ?? '');
      },
    },
    {
      name: 'url.decode',
      description: 'Decode a percent-encoded URL value',
      args: [{ label: 'Encoded Value', type: 'text', name: 'value', multiLine: true }],
      async onRender(_ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        try {
          return decodeURIComponent(args.values.value ?? '');
        } catch {
          return '';
        }
      },
    },
  ],
};
