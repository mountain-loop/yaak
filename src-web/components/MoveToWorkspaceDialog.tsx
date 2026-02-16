import type { GrpcRequest, HttpRequest, WebsocketRequest } from '@yaakapp-internal/models';
import { patchModel, workspacesAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { useState } from 'react';
import { pluralizeCount } from '../lib/pluralize';
import { resolvedModelName } from '../lib/resolvedModelName';
import { router } from '../lib/router';
import { showToast } from '../lib/toast';
import { Button } from './core/Button';
import { InlineCode } from './core/InlineCode';
import { Select } from './core/Select';
import { VStack } from './core/Stacks';

interface Props {
  activeWorkspaceId: string;
  requests: (HttpRequest | GrpcRequest | WebsocketRequest)[];
  onDone: () => void;
}

export function MoveToWorkspaceDialog({ onDone, requests, activeWorkspaceId }: Props) {
  const workspaces = useAtomValue(workspacesAtom);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(activeWorkspaceId);

  const targetWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId);
  const isSameWorkspace = selectedWorkspaceId === activeWorkspaceId;

  return (
    <VStack space={4} className="mb-4">
      <Select
        label="Target Workspace"
        name="workspace"
        value={selectedWorkspaceId}
        onChange={setSelectedWorkspaceId}
        options={workspaces.map((w) => ({
          label: w.id === activeWorkspaceId ? `${w.name} (current)` : w.name,
          value: w.id,
        }))}
      />
      <Button
        color="primary"
        disabled={isSameWorkspace}
        onClick={async () => {
          const patch = {
            workspaceId: selectedWorkspaceId,
            folderId: null,
          };

          await Promise.all(requests.map((r) => patchModel(r, patch)));

          // Hide after a moment, to give time for requests to disappear
          setTimeout(onDone, 100);
          showToast({
            id: 'workspace-moved',
            message:
              requests.length === 1 && requests[0] != null ? (
                <>
                  <InlineCode>{resolvedModelName(requests[0])}</InlineCode> moved to{' '}
                  <InlineCode>{targetWorkspace?.name ?? 'unknown'}</InlineCode>
                </>
              ) : (
                <>
                  {pluralizeCount('request', requests.length)} moved to{' '}
                  <InlineCode>{targetWorkspace?.name ?? 'unknown'}</InlineCode>
                </>
              ),
            action: ({ hide }) => (
              <Button
                size="xs"
                color="secondary"
                className="mr-auto min-w-[5rem]"
                onClick={async () => {
                  await router.navigate({
                    to: '/workspaces/$workspaceId',
                    params: { workspaceId: selectedWorkspaceId },
                  });
                  hide();
                }}
              >
                Switch to Workspace
              </Button>
            ),
          });
        }}
      >
        {requests.length === 1 ? 'Move' : `Move ${pluralizeCount('Request', requests.length)}`}
      </Button>
    </VStack>
  );
}
