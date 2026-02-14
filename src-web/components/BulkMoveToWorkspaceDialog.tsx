import type { GrpcRequest, HttpRequest, WebsocketRequest } from '@yaakapp-internal/models';
import { patchModel, workspacesAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { useState } from 'react';
import { resolvedModelName } from '../lib/resolvedModelName';
import { router } from '../lib/router';
import { showToast } from '../lib/toast';
import { Button } from './core/Button';
import { InlineCode } from './core/InlineCode';
import { Select } from './core/Select';
import { VStack } from './core/Stacks';
import { pluralizeCount } from '../lib/pluralize';
import { Prose } from './Prose';

interface Props {
  activeWorkspaceId: string;
  requests: (HttpRequest | GrpcRequest | WebsocketRequest)[];
  onDone: () => void;
}

export function BulkMoveToWorkspaceDialog({ onDone, requests, activeWorkspaceId }: Props) {
  const workspaces = useAtomValue(workspacesAtom);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(activeWorkspaceId);

  const targetWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId);
  const isSameWorkspace = selectedWorkspaceId === activeWorkspaceId;
  const requestCount = requests.length;

  return (
    <VStack space={4} className="mb-4">
      <div className="text-sm text-text-subtle">
        Moving {pluralizeCount('request', requestCount)} to another workspace.
        {requestCount > 1 && (
          <Prose className="mt-2 max-h-32 overflow-y-auto">
            <ul className="text-xs">
              {requests.map((r) => (
                <li key={r.id}>
                  <InlineCode>{resolvedModelName(r)}</InlineCode>
                </li>
              ))}
            </ul>
          </Prose>
        )}
      </div>
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

          await Promise.allSettled(requests.map((r) => patchModel(r, patch)));

          // Hide after a moment, to give time for requests to disappear
          setTimeout(onDone, 100);
          showToast({
            id: 'workspace-bulk-moved',
            message: (
              <>
                {pluralizeCount('request', requestCount)} moved to{' '}
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
        Move {pluralizeCount('Request', requestCount)}
      </Button>
    </VStack>
  );
}
