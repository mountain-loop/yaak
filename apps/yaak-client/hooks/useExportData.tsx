import { workspacesAtom } from '@yaakapp-internal/models';
import { ExportDataDialog } from '../components/ExportDataDialog';
import { showAlert } from '../lib/alert';
import { showDialog } from '../lib/dialog';
import { jotaiStore } from '../lib/jotai';
import { showToast } from '../lib/toast';
import { activeWorkspaceAtom } from './useActiveWorkspace';
import { useFastMutation } from './useFastMutation';

export function useExportData() {
  return useFastMutation({
    mutationKey: ['export_data'],
    onError: (err: string) => {
      showAlert({ id: 'export-failed', title: 'Export Failed', body: err });
    },
    mutationFn: async () => {
      const activeWorkspace = jotaiStore.get(activeWorkspaceAtom);
      const workspaces = jotaiStore.get(workspacesAtom);

      if (activeWorkspace == null || workspaces.length === 0) return;

      showDialog({
        id: 'export-data',
        title: 'Export Data',
        size: 'md',
        noPadding: true,
        render: ({ hide }) => (
          <ExportDataDialog
            onHide={hide}
            onSuccess={() => {
              showToast({
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
