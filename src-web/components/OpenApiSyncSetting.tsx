import { patchModel, type WorkspaceMeta } from '@yaakapp-internal/models';
import { useState } from 'react';
import { useStateWithDeps } from '../hooks/useStateWithDeps';
import { resyncOpenApi } from '../lib/importData';
import { Button } from './core/Button';
import { PlainInput } from './core/PlainInput';
import { VStack } from './core/Stacks';

interface Props {
  workspaceId: string;
  workspaceMeta: WorkspaceMeta;
}

export function OpenApiSyncSetting({ workspaceId, workspaceMeta }: Props) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [url, setUrl] = useStateWithDeps(workspaceMeta.openapiImportUrl ?? '', [
    workspaceMeta.id,
    workspaceMeta.openapiImportUrl,
  ]);
  const trimmedUrl = url.trim();
  const lastSyncedAt = workspaceMeta.openapiLastSyncedAt
    ? new Date(workspaceMeta.openapiLastSyncedAt).toLocaleString()
    : null;

  return (
    <VStack className="w-full my-2" space={2}>
      <PlainInput
        label="OpenAPI URL"
        size="xs"
        help="Import and manually resync an OpenAPI document from a remote URL."
        defaultValue={url}
        placeholder="https://example.com/openapi.yaml"
        onChange={(value) => {
          setUrl(value);
          patchModel(workspaceMeta, {
            openapiImportUrl: value.trim() === '' ? null : value.trim(),
          }).catch(console.error);
        }}
      />

      {lastSyncedAt != null && (
        <div className="text-xs text-text-subtle">Last synced: {lastSyncedAt}</div>
      )}

      <div>
        <Button
          size="xs"
          color="primary"
          disabled={trimmedUrl === '' || isSyncing}
          isLoading={isSyncing}
          onClick={async () => {
            setIsSyncing(true);
            try {
              await resyncOpenApi.mutateAsync({ url: trimmedUrl, workspaceId });
            } finally {
              setIsSyncing(false);
            }
          }}
        >
          Resync OpenAPI
        </Button>
      </div>
    </VStack>
  );
}
