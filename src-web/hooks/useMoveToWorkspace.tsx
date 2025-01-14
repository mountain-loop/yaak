import React from 'react';
import { MoveToWorkspaceDialog } from '../components/MoveToWorkspaceDialog';
import { showDialog } from '../lib/dialog';
import { getActiveWorkspaceId } from './useActiveWorkspace';
import { useFastMutation } from './useFastMutation';
import { getRequests } from './useRequests';

export function useMoveToWorkspace(id: string) {
  return useFastMutation<void, unknown>({
    mutationKey: ['move_workspace', id],
    mutationFn: async () => {
      const activeWorkspaceId = getActiveWorkspaceId();
      if (activeWorkspaceId == null) return;

      const request = getRequests().find((r) => r.id === id);
      if (request == null) return;

      showDialog({
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
