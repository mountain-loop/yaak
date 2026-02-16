import type { GrpcRequest, HttpRequest, WebsocketRequest } from '@yaakapp-internal/models';

import { MoveToWorkspaceDialog } from '../components/MoveToWorkspaceDialog';
import { activeWorkspaceIdAtom } from '../hooks/useActiveWorkspace';
import { createFastMutation } from '../hooks/useFastMutation';
import { pluralizeCount } from '../lib/pluralize';
import { showDialog } from '../lib/dialog';
import { jotaiStore } from '../lib/jotai';

export const moveToWorkspace = createFastMutation({
  mutationKey: ['move_workspace'],
  mutationFn: async (requests: (HttpRequest | GrpcRequest | WebsocketRequest)[]) => {
    const activeWorkspaceId = jotaiStore.get(activeWorkspaceIdAtom);
    if (activeWorkspaceId == null) return;
    if (requests.length === 0) return;

    const title =
      requests.length === 1
        ? 'Move Request'
        : `Move ${pluralizeCount('Request', requests.length)}`;

    showDialog({
      id: 'change-workspace',
      title,
      size: 'sm',
      render: ({ hide }) => (
        <MoveToWorkspaceDialog
          onDone={hide}
          requests={requests}
          activeWorkspaceId={activeWorkspaceId}
        />
      ),
    });
  },
});
