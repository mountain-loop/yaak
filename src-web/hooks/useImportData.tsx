import { useMutation } from './useMutation';
import type {
  Environment,
  Folder,
  GrpcRequest,
  HttpRequest,
  Workspace,
} from '@yaakapp-internal/models';
import { Button } from '../components/core/Button';
import { FormattedError } from '../components/core/FormattedError';
import { VStack } from '../components/core/Stacks';
import { useDialog } from '../components/DialogContext';
import { ImportDataDialog } from '../components/ImportDataDialog';
import { count } from '../lib/pluralize';
import { invokeCmd } from '../lib/tauri';
import { Route } from '../routes/workspaces/$workspaceId';
import { useActiveWorkspace } from './useActiveWorkspace';
import { useAlert } from './useAlert';
import { router } from '../main';

export function useImportData() {
  const dialog = useDialog();
  const alert = useAlert();
  const activeWorkspace = useActiveWorkspace();

  const importData = async (filePath: string): Promise<boolean> => {
    const imported: {
      workspaces: Workspace[];
      environments: Environment[];
      folders: Folder[];
      httpRequests: HttpRequest[];
      grpcRequests: GrpcRequest[];
    } = await invokeCmd('cmd_import_data', {
      filePath,
      workspaceId: activeWorkspace?.id,
    });

    const importedWorkspace = imported.workspaces[0];

    dialog.show({
      id: 'import-complete',
      title: 'Import Complete',
      size: 'sm',
      hideX: true,
      render: ({ hide }) => {
        const { workspaces, environments, folders, httpRequests, grpcRequests } = imported;
        return (
          <VStack space={3} className="pb-4">
            <ul className="list-disc pl-6">
              <li>{count('Workspace', workspaces.length)}</li>
              <li>{count('Environment', environments.length)}</li>
              <li>{count('Folder', folders.length)}</li>
              <li>{count('HTTP Request', httpRequests.length)}</li>
              <li>{count('GRPC Request', grpcRequests.length)}</li>
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
      router.navigate({
        to: Route.fullPath,
        params: { workspaceId: importedWorkspace.id },
        search: { environmentId },
      });
    }

    return true;
  };

  return useMutation({
    mutationKey: ['import_data'],
    onError: (err: string) => {
      alert({
        id: 'import-failed',
        title: 'Import Failed',
        size: 'md',
        body: <FormattedError>{err}</FormattedError>,
      });
    },
    mutationFn: async () => {
      return new Promise<void>((resolve, reject) => {
        dialog.show({
          id: 'import',
          title: 'Import Data',
          size: 'sm',
          render: ({ hide }) => {
            const importAndHide = async (filePath: string) => {
              try {
                const didImport = await importData(filePath);
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
}
