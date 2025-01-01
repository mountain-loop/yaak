import React from 'react';
import { MoveToWorkspaceDialog } from '../components/MoveToWorkspaceDialog';
import { getActiveWorkspaceId } from './useActiveWorkspace';
import { useDialog } from './useDialog';
import { useFastMutation } from './useFastMutation';
import { useRequests } from './useRequests';

export function useMoveToWorkspace(id: string) {
  const dialog = useDialog();
  const requests = useRequests();
  const request = requests.find((r) => r.id === id);

  return useFastMutation<void, unknown>({
    mutationKey: ['move_workspace', id],
    mutationFn: async () => {
      const activeWorkspaceId = getActiveWorkspaceId();
      if (request == null || activeWorkspaceId == null) return;

      dialog.show({
        id: 'change-workspace',
        title: 'Move Workspace',
        size: 'sm',
        render: ({ hide }) => (
          <MoveToWorkspaceDialog
            onDone={hide}
            request={request}
            activeWorkspaceId={activeWorkspaceId}
          />
        ),
      });
    },
  });
}
