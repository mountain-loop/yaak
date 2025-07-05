import { convertPostman } from '@yaak/importer-postman/src';
import type { Context, PluginDefinition } from '@yaakapp/api';
import type { ImportPluginResponse } from '@yaakapp/api/lib/plugins/ImporterPlugin';
import { convert } from 'openapi-to-postmanv2';

export const plugin: PluginDefinition = {
  importer: {
    name: 'OpenAPI',
    description: 'Import OpenAPI collections',
    onImport(_ctx: Context, args: { text: string }) {
      return convertOpenApi(args.text);
    },
  },
};

export async function convertOpenApi(contents: string): Promise<ImportPluginResponse | undefined> {
  let postmanCollection;
  try {
    postmanCollection = await new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      convert({ type: 'string', data: contents }, {}, (err, result: any) => {
        if (err != null) reject(err);

        if (Array.isArray(result.output) && result.output.length > 0) {
          resolve(result.output[0].data);
        }
      });
    });
  } catch {
    // Probably not an OpenAPI file, so skip it
    return undefined;
  }

  return convertPostman(JSON.stringify(postmanCollection));
}
