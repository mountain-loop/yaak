import type { BatchUpsertResult } from "@yaakapp-internal/models";
import { FormattedError, VStack } from "@yaakapp-internal/ui";
import { Button } from "../components/core/Button";
import { ImportDataDialog } from "../components/ImportDataDialog";
import { createFastMutation } from "../hooks/useFastMutation";
import { showAlert } from "./alert";
import { showDialog } from "./dialog";
import { pluralizeCount } from "./pluralize";
import { router } from "./router";
import { rpc } from "./rpc";

export const importData = createFastMutation({
  mutationKey: ["import_data"],
  onError: (err: string) => {
    showAlert({
      id: "import-failed",
      title: "Import Failed",
      size: "md",
      body: <FormattedError>{err}</FormattedError>,
    });
  },
  mutationFn: async () => {
    return new Promise<void>((resolve, reject) => {
      showDialog({
        id: "import",
        title: "Import Data",
        size: "sm",
        render: ({ hide }) => {
          const importAndHide = async (runImport: () => Promise<BatchUpsertResult>) => {
            try {
              await finishImport(await runImport());
              resolve();
            } catch (err) {
              reject(err);
            } finally {
              hide();
            }
          };
          return (
            <ImportDataDialog
              importFile={(filePath) =>
                importAndHide(() => rpc<BatchUpsertResult>("cmd_import_data", { filePath }))
              }
              importUrl={(url) =>
                importAndHide(() => rpc<BatchUpsertResult>("cmd_import_url", { url }))
              }
            />
          );
        },
      });
    });
  },
});

async function finishImport(imported: BatchUpsertResult): Promise<void> {
  const importedWorkspace = imported.workspaces[0];

  showDialog({
    id: "import-complete",
    title: "Import Complete",
    size: "sm",
    hideX: true,
    render: ({ hide }) => {
      return (
        <VStack space={3} className="pb-4">
          <ul className="list-disc pl-6">
            {imported.workspaces.length > 0 && (
              <li>{pluralizeCount("Workspace", imported.workspaces.length)}</li>
            )}
            {imported.environments.length > 0 && (
              <li>{pluralizeCount("Environment", imported.environments.length)}</li>
            )}
            {imported.folders.length > 0 && (
              <li>{pluralizeCount("Folder", imported.folders.length)}</li>
            )}
            {imported.httpRequests.length > 0 && (
              <li>{pluralizeCount("HTTP Request", imported.httpRequests.length)}</li>
            )}
            {imported.grpcRequests.length > 0 && (
              <li>{pluralizeCount("GRPC Request", imported.grpcRequests.length)}</li>
            )}
            {imported.websocketRequests.length > 0 && (
              <li>{pluralizeCount("Websocket Request", imported.websocketRequests.length)}</li>
            )}
          </ul>
          <div>
            <Button className="ml-auto" onClick={hide} color="primary">
              Done
            </Button>
          </div>
        </VStack>
      );
    },
  });

  if (importedWorkspace != null) {
    const environmentId = imported.environments[0]?.id ?? null;
    await router.navigate({
      to: "/workspaces/$workspaceId",
      params: { workspaceId: importedWorkspace.id },
      search: { environment_id: environmentId },
    });
  }
}
