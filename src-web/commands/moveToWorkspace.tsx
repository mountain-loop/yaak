import type { GrpcRequest, HttpRequest, WebsocketRequest } from '@yaakapp-internal/models';
import React from 'react';
import { MoveToWorkspaceDialog } from '../components/MoveToWorkspaceDialog';
import { activeWorkspaceIdAtom } from '../hooks/useActiveWorkspace';
import { createFastMutation } from '../hooks/useFastMutation';
import { showDialog } from '../lib/dialog';
import { jotaiStore } from '../lib/jotai';

export const moveToWorkspace = createFastMutation({
  mutationKey: ['move_workspace'],
  mutationFn: async (request: HttpRequest | GrpcRequest | WebsocketRequest) => {
    const activeWorkspaceId = jotaiStore.get(activeWorkspaceIdAtom);
    if (activeWorkspaceId == null) return;

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
