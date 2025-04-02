import { enableEncryption } from '@yaakapp-internal/crypto';
import type { WorkspaceMeta } from '@yaakapp-internal/models';
import { useState } from 'react';
import { useCopy } from '../hooks/useCopy';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import { IconButton } from './core/IconButton';
import { InlineCode } from './core/InlineCode';
import { HStack, VStack } from './core/Stacks';

interface Props {
  workspaceMeta: WorkspaceMeta;
}

export function EnableWorkspaceEncryptionSetting({ workspaceMeta }: Props) {
  const [key, setKey] = useState<string | null>(null);
  const copy = useCopy({ disableToast: true });

  if (workspaceMeta.encryptionKey) {
    return <div>Encryption is enabled</div>
  }

  return (
    <VStack space={3} alignItems="start">
      {key ? (
        <div>
          <Banner color="secondary">
            <HStack space={1}>
              <InlineCode>{key}</InlineCode>
              <IconButton
                showConfirm
                size="sm"
                onClick={() => copy(key)}
                icon="copy"
                title="Copy key"
              />
            </HStack>
          </Banner>
        </div>
      ) : (
        <Button
          color="secondary"
          size="sm"
          onClick={async () => {
            const newKey = await enableEncryption(workspaceMeta.workspaceId);
            setKey(newKey);
          }}
        >
          Enable Encryption
        </Button>
      )}
    </VStack>
  );
}
