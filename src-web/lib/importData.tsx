import type { BatchUpsertResult } from '@yaakapp-internal/models';
import { Button } from '../components/core/Button';
import { FormattedError } from '../components/core/FormattedError';
import { VStack } from '../components/core/Stacks';
import { ImportDataDialog } from '../components/ImportDataDialog';
import { activeWorkspaceAtom } from '../hooks/useActiveWorkspace';
import { createFastMutation } from '../hooks/useFastMutation';
import { showAlert } from './alert';
import { showDialog } from './dialog';
import { jotaiStore } from './jotai';
import { pluralizeCount } from './pluralize';
import { router } from './router';
import { invokeCmd } from './tauri';

export const importData = createFastMutation({
  mutationKey: ['import_data'],
  onError: (err: string) => {
    showAlert({
      id: 'import-failed',
      title: 'Import Failed',
      size: 'md',
      body: <FormattedError>{err}</FormattedError>,
    });
  },
  mutationFn: async () => {
    return new Promise<void>((resolve, reject) => {
      showDialog({
        id: 'import',
        title: 'Import Data',
        size: 'sm',
        render: ({ hide }) => {
          const importAndHide = async (filePath: string) => {
            try {
              const didImport = await performImport(filePath);
              if (!didImport) {
                return;
              }
              resolve();
            } catch (err) {
              reject(err);
            } finally {
              hide();
            }
          };
          return <ImportDataDialog importData={importAndHide} />;
        },
      });
    });
  },
});

async function performImport(filePath: string): Promise<boolean> {
  const activeWorkspace = jotaiStore.get(activeWorkspaceAtom);
  const imported = await invokeCmd<BatchUpsertResult>('cmd_import_data', {
    filePath,
    workspaceId: activeWorkspace?.id,
  });

  const importedWorkspace = imported.workspaces[0];

  showDialog({
    id: 'import-complete',
    title: 'Import Complete',
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

  if (importedWorkspace != null) {
    const environmentId = imported.environments[0]?.id ?? null;
    await router.navigate({
      to: '/workspaces/$workspaceId',
      params: { workspaceId: importedWorkspace.id },
      search: { environment_id: environmentId },
    });
  }

  return true;
}
