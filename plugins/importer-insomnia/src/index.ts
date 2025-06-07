import { Context, PluginDefinition } from '@yaakapp/api';
import YAML from 'yaml';
import { deleteUndefinedAttrs, isJSObject } from './common';
import { convertInsomniaV4 } from './v4';
import { convertInsomniaV5 } from './v5';

export const plugin: PluginDefinition = {
  importer: {
    name: 'Insomnia',
    description: 'Import Insomnia workspaces',
    async onImport(_ctx: Context, args: { text: string }) {
      return convertInsomnia(args.text);
    },
  },
};

export function convertInsomnia(contents: string) {
  let parsed: any;

  try {
    parsed = JSON.parse(contents);
  } catch (e) {
  }

  try {
    parsed = parsed ?? YAML.parse(contents);
  } catch (e) {
  }

  if (!isJSObject(parsed)) return null;

  const result = convertInsomniaV5(parsed) ?? convertInsomniaV4(parsed);

  return deleteUndefinedAttrs(result);
}
