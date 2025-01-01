import { ExportDataDialog } from '../components/ExportDataDialog';
import { jotaiStore } from '../lib/jotai';
import { getActiveWorkspace } from './useActiveWorkspace';
import { useAlert } from './useAlert';
import { useDialog } from './useDialog';
import { useFastMutation } from './useFastMutation';
import { useToast } from './useToast';
import { workspacesAtom } from './useWorkspaces';

export function useExportData() {
  const alert = useAlert();
  const dialog = useDialog();
  const toast = useToast();

  return useFastMutation({
    mutationKey: ['export_data'],
    onError: (err: string) => {
      alert({ id: 'export-failed', title: 'Export Failed', body: err });
    },
    mutationFn: async () => {
      const activeWorkspace = getActiveWorkspace();
      const workspaces = jotaiStore.get(workspacesAtom);

      if (activeWorkspace == null || workspaces.length === 0) return;

      dialog.show({
        id: 'export-data',
        title: 'Export App Data',
        size: 'md',
        noPadding: true,
        render: ({ hide }) => (
          <ExportDataDialog
            onHide={hide}
            onSuccess={() => {
              toast.show({
                color: 'success',
                message: 'Data export successful',
              });
            }}
          />
        ),
      });
    },
  });
}
