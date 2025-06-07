import { CallTemplateFunctionArgs, Context, PluginDefinition } from '@yaakapp/api';
import { createHash, createHmac } from 'node:crypto';

const algorithms = ['md5', 'sha1', 'sha256', 'sha512'] as const;
const encodings = ['base64', 'hex'] as const;

type TemplateFunctionPlugin = NonNullable<PluginDefinition['templateFunctions']>[number];

const hashFunctions: TemplateFunctionPlugin[] = algorithms.map(algorithm => ({
  name: `hash.${algorithm}`,
  description: 'Hash a value to its hexidecimal representation',
  args: [
    {
      type: 'text',
      name: 'input',
      label: 'Input',
      placeholder: 'input text',
      multiLine: true,
    },
    {
      type: 'select',
      name: 'encoding',
      label: 'Encoding',
      defaultValue: 'base64',
      options: encodings.map(encoding => ({
        label: capitalize(encoding),
        value: encoding,
      })),
    },
  ],
  async onRender(_ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
    const input = String(args.values.input);
    const encoding = String(args.values.encoding) as typeof encodings[number];

    return createHash(algorithm)
      .update(input, 'utf-8')
      .digest(encoding);
  },
}));

const hmacFunctions: TemplateFunctionPlugin[] = algorithms.map(algorithm => ({
  name: `hmac.${algorithm}`,
  description: 'Compute the HMAC of a value',
  args: [
    {
      type: 'text',
      name: 'input',
      label: 'Input',
      placeholder: 'input text',
      multiLine: true,
    },
    {
      type: 'text',
      name: 'key',
      label: 'Key',
      password: true,
    },
    {
      type: 'select',
      name: 'encoding',
      label: 'Encoding',
      defaultValue: 'base64',
      options: encodings.map(encoding => ({
        value: encoding,
        label: capitalize(encoding),
      })),
    },
  ],
  async onRender(_ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
    const input = String(args.values.input);
    const key = String(args.values.key);
    const encoding = String(args.values.encoding) as typeof encodings[number];

    return createHmac(algorithm, key, {})
      .update(input)
      .digest(encoding);
  },
}));

export const plugin: PluginDefinition = {
  templateFunctions: [...hashFunctions, ...hmacFunctions],
};

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
