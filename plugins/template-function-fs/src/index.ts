import type { CallTemplateFunctionArgs, Context, PluginDefinition } from '@yaakapp/api';
import fs from 'node:fs';

const UTF8 = 'utf8';
const options = [
  { label: 'ASCII', value: 'ascii' },
  { label: 'UTF-8', value: UTF8 },
  { label: 'UTF-16 LE', value: 'utf16le' },
  { label: 'Base64', value: 'base64' },
  { label: 'Base64 URL-safe', value: 'base64url' },
  { label: 'Latin-1', value: 'latin1' },
  { label: 'Hexadecimal', value: 'hex' },
];
export const plugin: PluginDefinition = {
  templateFunctions: [
    {
      name: 'fs.readFile',
      description: 'Read the contents of a file as utf-8',
      args: [
        { title: 'Select File', type: 'file', name: 'path', label: 'File' },
        {
          type: 'select',
          name: 'encoding',
          label: 'Encoding',
          defaultValue: UTF8,
          description: "Specifies how the file's bytes are decoded into text when read",
          options,
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
