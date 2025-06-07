import { Context, Environment, Folder, HttpRequest, PluginDefinition, Workspace } from '@yaakapp/api';
import { convert } from 'openapi-to-postmanv2';
import { convertPostman } from '@yaakapp/importer-postman/src';

type AtLeast<T, K extends keyof T> = Partial<T> & Pick<T, K>;

interface ExportResources {
  workspaces: AtLeast<Workspace, 'name' | 'id' | 'model'>[];
  environments: AtLeast<Environment, 'name' | 'id' | 'model' | 'workspaceId'>[];
  httpRequests: AtLeast<HttpRequest, 'name' | 'id' | 'model' | 'workspaceId'>[];
  folders: AtLeast<Folder, 'name' | 'id' | 'model' | 'workspaceId'>[];
}

export const plugin: PluginDefinition = {
  importer: {
    name: 'OpenAPI',
    description: 'Import OpenAPI collections',
    onImport(_ctx: Context, args: { text: string }) {
      return convertOpenApi(args.text) as any;
    },
  },
};

export async function convertOpenApi(
  contents: string,
): Promise<{ resources: ExportResources } | undefined> {
  let postmanCollection;
  try {
    postmanCollection = await new Promise((resolve, reject) => {
      convert({ type: 'string', data: contents }, {}, (err, result: any) => {
        if (err != null) reject(err);

        if (Array.isArray(result.output) && result.output.length > 0) {
          resolve(result.output[0].data);
        }
      });
    });
  } catch (err) {
    // Probably not an OpenAPI file, so skip it
    return undefined;
  }

  return convertPostman(JSON.stringify(postmanCollection));
}
