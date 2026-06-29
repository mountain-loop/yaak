import { convertPostman } from "@yaak/importer-postman/src";
import type { ImportPluginResponse } from "@yaakapp/api/lib/plugins/ImporterPlugin";
import { convert } from "openapi-to-postmanv2";

export async function convertOpenApiWithPostman(
  contents: string,
): Promise<ImportPluginResponse | undefined> {
  // oxlint-disable-next-line no-explicit-any
  let postmanCollection: any;
  try {
    postmanCollection = await new Promise((resolve, reject) => {
      // oxlint-disable-next-line no-explicit-any
      convert({ type: "string", data: contents }, {}, (err, result: any) => {
        if (err != null) reject(err);

        if (Array.isArray(result.output) && result.output.length > 0) {
          resolve(result.output[0].data);
        }
      });
    });
  } catch {
    return undefined;
  }

  return convertPostman(JSON.stringify(postmanCollection));
}
