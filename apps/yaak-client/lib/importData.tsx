import type { BatchUpsertResult, ImportDestination, ImportPlan } from "@yaakapp-internal/models";
import { FormattedError, VStack } from "@yaakapp-internal/ui";
import { Button } from "../components/core/Button";
import { ImportDataDialog } from "../components/ImportDataDialog";
import { activeFolderAtom } from "../hooks/useActiveFolder";
import { activeWorkspaceAtom } from "../hooks/useActiveWorkspace";
import { createFastMutation } from "../hooks/useFastMutation";
import { showAlert } from "./alert";
import { showDialog } from "./dialog";
import { jotaiStore } from "./jotai";
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
      const currentWorkspace = jotaiStore.get(activeWorkspaceAtom);
      const selectedFolder = jotaiStore.get(activeFolderAtom);
      showDialog({
        id: "import",
        title: "Import Data",
        size: "sm",
        disableClose: true,
        render: ({ hide }) => {
          const cancel = () => {
            hide();
            resolve();
          };
          const fail = (err: unknown) => {
            hide();
            reject(err);
          };
          const commit = async (plan: ImportPlan) => {
            const imported = await rpc<BatchUpsertResult>("cmd_commit_import", { plan });
            hide();
            await finishImport(imported);
            resolve();
          };
          return (
            <ImportDataDialog
              currentWorkspace={currentWorkspace}
              selectedFolder={selectedFolder}
              planFile={(filePath: string, destination: ImportDestination) =>
                rpc<ImportPlan>("cmd_import_data", { filePath, destination })
              }
              planUrl={(url: string, destination: ImportDestination) =>
                rpc<ImportPlan>("cmd_import_url", { url, destination })
              }
              commit={commit}
              cancel={cancel}
              onError={fail}
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
