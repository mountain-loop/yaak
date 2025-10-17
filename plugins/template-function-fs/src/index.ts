import type { CallTemplateFunctionArgs, Context, PluginDefinition } from '@yaakapp/api';
import fs from 'node:fs';

const options = [
  'ascii',
  'utf8',
  'utf-8',
  'utf16le',
  'utf-16le',
  'ucs2',
  'ucs-2',
  'base64',
  'base64url',
  'latin1',
  'binary',
  'hex',
].map((it) => ({
  label: it,
  value: it,
}));

export const plugin: PluginDefinition = {
  templateFunctions: [
    {
      name: 'fs.readFile',
      description: 'Read the contents of a file as utf-8',
      args: [
        { title: 'Select File', type: 'file', name: 'path', label: 'File' },
        {
          title: 'Select encoding',
          type: 'select',
          name: 'encoding',
          label: 'Encoding',
          options,
          defaultValue: 'utf-8',
        },
      ],
      async onRender(_ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        if (!args.values.path || !args.values.encoding) return null;

        try {
          return fs.promises.readFile(String(args.values.path ?? ''), {
            encoding: String(args.values.encoding ?? 'utf-8') as BufferEncoding,
          });
        } catch {
          return null;
        }
      },
    },
  ],
};
