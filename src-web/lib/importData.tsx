import type { BatchUpsertResult } from '@yaakapp-internal/models';
import { Button } from '../components/core/Button';
import { FormattedError } from '../components/core/FormattedError';
import { VStack } from '../components/core/Stacks';
import { ImportDataDialog } from '../components/ImportDataDialog';
import { createFastMutation } from '../hooks/useFastMutation';
import { showAlert } from './alert';
import { showDialog } from './dialog';
import { pluralizeCount } from './pluralize';
import { router } from './router';
import { invokeCmd } from './tauri';

export const importData = createFastMutation({
  mutationKey: ['import_data'],
  onError: showImportError,
  mutationFn: async () => {
    return new Promise<void>((resolve, reject) => {
      showDialog({
        id: 'import',
        title: 'Import Data',
        size: 'sm',
        render: ({ hide }) => {
          const importAndHide = async (runImport: () => Promise<void>) => {
            try {
              await runImport();
              resolve();
            } catch (err) {
              reject(err);
            } finally {
              hide();
            }
          };

          return (
            <ImportDataDialog
              importFile={(filePath) => importAndHide(() => performFileImport(filePath))}
              importOpenApiUrl={(url) => importAndHide(() => performOpenApiUrlImport(url))}
            />
          );
        },
      });
    });
  },
});

export const resyncOpenApi = createFastMutation<
  BatchUpsertResult,
  string,
  { url: string; workspaceId: string }
>({
  mutationKey: ['resync_openapi'],
  onError: showImportError,
  mutationFn: async ({ url, workspaceId }) => {
    const imported = await invokeCmd<BatchUpsertResult>('cmd_import_openapi_url', {
      url,
      targetWorkspaceId: workspaceId,
    });
    showImportComplete(imported, { title: 'OpenAPI Resync Complete' });
    return imported;
  },
});

async function performFileImport(filePath: string): Promise<void> {
  const imported = await invokeCmd<BatchUpsertResult>('cmd_import_data', { filePath });
  showImportComplete(imported, { title: 'Import Complete' });
  await navigateToImportedWorkspace(imported);
}

async function performOpenApiUrlImport(url: string): Promise<void> {
  const imported = await invokeCmd<BatchUpsertResult>('cmd_import_openapi_url', { url });
  showImportComplete(imported, { title: 'Import Complete' });
  await navigateToImportedWorkspace(imported);
}

function showImportError(err: unknown) {
  showAlert({
    id: 'import-failed',
    title: 'Import Failed',
    size: 'md',
    body: <FormattedError>{String(err)}</FormattedError>,
  });
}

function showImportComplete(imported: BatchUpsertResult, { title }: { title: string }) {
  showDialog({
    id: 'import-complete',
    title,
    size: 'sm',
    hideX: true,
    render: ({ hide }) => {
      return (
        <VStack space={3} className="pb-4">
          <ul className="list-disc pl-6">
            {imported.workspaces.length > 0 && (
              <li>{pluralizeCount('Workspace', imported.workspaces.length)}</li>
            )}
            {imported.environments.length > 0 && (
              <li>{pluralizeCount('Environment', imported.environments.length)}</li>
            )}
            {imported.folders.length > 0 && (
              <li>{pluralizeCount('Folder', imported.folders.length)}</li>
            )}
            {imported.httpRequests.length > 0 && (
              <li>{pluralizeCount('HTTP Request', imported.httpRequests.length)}</li>
            )}
            {imported.grpcRequests.length > 0 && (
              <li>{pluralizeCount('GRPC Request', imported.grpcRequests.length)}</li>
            )}
            {imported.websocketRequests.length > 0 && (
              <li>{pluralizeCount('Websocket Request', imported.websocketRequests.length)}</li>
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
}

async function navigateToImportedWorkspace(imported: BatchUpsertResult) {
  const importedWorkspace = imported.workspaces[0];
  if (importedWorkspace == null) {
    return;
  }

  const environmentId = imported.environments[0]?.id ?? null;
  await router.navigate({
    to: '/workspaces/$workspaceId',
    params: { workspaceId: importedWorkspace.id },
    search: { environment_id: environmentId },
  });
}
