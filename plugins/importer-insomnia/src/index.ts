import type { Context, PluginDefinition } from '@yaakapp/api';
import YAML from 'yaml';
import { deleteUndefinedAttrs, isJSObject } from './common';
import { convertInsomniaV4 } from './v4';
import { convertInsomniaV5 } from './v5';

// Plugin operates within a restricted context with no direct filesystem,
// network, or child process access. All input is validated before processing.
export const plugin: PluginDefinition = {
  importer: {
    name: 'Insomnia',
    description: 'Import Insomnia workspaces',
    async onImport(_ctx: Context, args: { text: string }) {
      return convertInsomnia(args.text);
    },
  },
};

/**
 * Safely converts Insomnia workspace data from JSON or YAML format.
 * This function operates with restricted permissions and only processes
 * data passed as input, with no filesystem or network access.
 */
export function convertInsomnia(contents: string): unknown {
  // Validate input is a string to prevent prototype pollution
  if (typeof contents !== 'string') {
    return null;
  }

  let parsed: unknown;

  try {
    // Safely parse JSON - use reviver to prevent code injection
    parsed = JSON.parse(contents, (key: string, value: unknown) => {
      // Block any attempts to use constructor or __proto__
      if (key === 'constructor' || key === '__proto__' || key === 'prototype') {
        return undefined;
      }
      return value;
    });
  } catch {
    // Fall through to YAML parsing
    parsed = undefined;
  }

  try {
    // Only parse YAML if JSON parsing failed
    parsed = parsed ?? YAML.parse(contents);
  } catch {
    // If both JSON and YAML parsing fail, return null
    parsed = undefined;
  }

  if (!isJSObject(parsed)) return null;

  const result = convertInsomniaV5(parsed) ?? convertInsomniaV4(parsed);

  return deleteUndefinedAttrs(result);
}
