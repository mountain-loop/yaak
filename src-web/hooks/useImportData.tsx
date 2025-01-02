import { useNavigate } from '@tanstack/react-router';
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
import { ImportDataDialog } from '../components/ImportDataDialog';
import { pluralizeCount } from '../lib/pluralize';
import { invokeCmd } from '../lib/tauri';
import { getActiveWorkspace } from './useActiveWorkspace';
import { useAlert } from './useAlert';
import { useDialog } from './useDialog';
import { useFastMutation } from './useFastMutation';

export function useImportData() {
  const dialog = useDialog();
  const alert = useAlert();
  const navigate = useNavigate();

  const importData = async (filePath: string): Promise<boolean> => {
    const activeWorkspace = getActiveWorkspace();
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
              <li>{pluralizeCount('Workspace', workspaces.length)}</li>
              <li>{pluralizeCount('Environment', environments.length)}</li>
              <li>{pluralizeCount('Folder', folders.length)}</li>
              <li>{pluralizeCount('HTTP Request', httpRequests.length)}</li>
              <li>{pluralizeCount('GRPC Request', grpcRequests.length)}</li>
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
      await navigate({
        to: '/workspaces/$workspaceId',
        params: { workspaceId: importedWorkspace.id },
        search: { environment_id: environmentId },
      });
    }

    return true;
  };

  return useFastMutation({
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
