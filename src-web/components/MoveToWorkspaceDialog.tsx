import type {
  GrpcRequest,
  HttpRequest,
  WebsocketRequest} from '@yaakapp-internal/models';
import {
  patchModel,
  workspacesAtom,
} from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import React, { useState } from 'react';
import { resolvedModelName } from '../lib/resolvedModelName';
import { router } from '../lib/router';
import { showToast } from '../lib/toast';
import { Button } from './core/Button';
import { InlineCode } from './core/InlineCode';
import { Select } from './core/Select';
import { VStack } from './core/Stacks';

interface Props {
  activeWorkspaceId: string;
  request: HttpRequest | GrpcRequest | WebsocketRequest;
  onDone: () => void;
}

export function MoveToWorkspaceDialog({ onDone, request, activeWorkspaceId }: Props) {
  const workspaces = useAtomValue(workspacesAtom);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(activeWorkspaceId);

  return (
    <VStack space={4} className="mb-4">
      <Select
        label="New Workspace"
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
        disabled={selectedWorkspaceId === activeWorkspaceId}
        onClick={async () => {
          const patch = {
            workspaceId: selectedWorkspaceId,
            folderId: null,
          };

          await patchModel(request, patch);

          // Hide after a moment, to give time for request to disappear
          setTimeout(onDone, 100);
          showToast({
            id: 'workspace-moved',
            message: (
              <>
                <InlineCode>{resolvedModelName(request)}</InlineCode> moved to{' '}
                <InlineCode>
                  {workspaces.find((w) => w.id === selectedWorkspaceId)?.name ?? 'unknown'}
                </InlineCode>
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
        Move
      </Button>
    </VStack>
  );
}
