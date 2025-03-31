import React from 'react';
import { MoveToWorkspaceDialog } from '../components/MoveToWorkspaceDialog';
import { showDialog } from '../lib/dialog';
import { jotaiStore } from '../lib/jotai';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';
import { useFastMutation } from './useFastMutation';
import { allRequestsAtom } from './useAllRequests';

export function useMoveToWorkspace(id: string) {
  return useFastMutation<void, unknown>({
    mutationKey: ['move_workspace', id],
    mutationFn: async () => {
      const activeWorkspaceId = jotaiStore.get(activeWorkspaceIdAtom);
      if (activeWorkspaceId == null) return;

      const request = jotaiStore.get(allRequestsAtom).find((r) => r.id === id);
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
