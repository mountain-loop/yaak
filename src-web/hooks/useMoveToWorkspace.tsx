import {useDialog} from "./useDialog";
import { useFastMutation } from './useFastMutation';
import React from 'react';
import { MoveToWorkspaceDialog } from '../components/MoveToWorkspaceDialog';
import { useActiveWorkspace } from './useActiveWorkspace';
import { useRequests } from './useRequests';

export function useMoveToWorkspace(id: string) {
  const dialog = useDialog();
  const requests = useRequests();
  const request = requests.find((r) => r.id === id);
  const activeWorkspace = useActiveWorkspace();

  return useFastMutation<void, unknown>({
    mutationKey: ['move_workspace', id],
    mutationFn: async () => {
      if (request == null || activeWorkspace == null) return;

      dialog.show({
        id: 'change-workspace',
        title: 'Move Workspace',
        size: 'sm',
        render: ({ hide }) => (
          <MoveToWorkspaceDialog
            onDone={hide}
            request={request}
            activeWorkspaceId={activeWorkspace.id}
          />
        ),
      });
    },
  });
}
