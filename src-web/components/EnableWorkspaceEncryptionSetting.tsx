import { enableEncryption, revealWorkspaceKey } from '@yaakapp-internal/crypto';
import type { WorkspaceMeta } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { useEffect, useState } from 'react';
import { useStateWithDeps } from '../hooks/useStateWithDeps';
import { CopyIconButton } from './CopyIconButton';
import { Button } from './core/Button';
import { IconButton } from './core/IconButton';
import { HStack, VStack } from './core/Stacks';

interface Props {
  workspaceMeta: WorkspaceMeta;
}

export function EnableWorkspaceEncryptionSetting({ workspaceMeta }: Props) {
  const [justEnabledEncryption, setJustEnabledEncryption] = useState<boolean>(false);
  if (workspaceMeta.encryptionKey) {
    return (
      <KeyRevealer defaultShow={justEnabledEncryption} workspaceId={workspaceMeta.workspaceId} />
    );
  }

  return (
    <VStack space={3} alignItems="start">
      <Button
        color="secondary"
        size="sm"
        onClick={async () => {
          setJustEnabledEncryption(true);
          await enableEncryption(workspaceMeta.workspaceId);
        }}
      >
        Enable Encryption
      </Button>
    </VStack>
  );
}

function KeyRevealer({
  workspaceId,
  defaultShow = false,
}: {
  workspaceId: string;
  defaultShow?: boolean;
}) {
  const [key, setKey] = useState<string | null>(null);
  const [show, setShow] = useStateWithDeps<boolean>(defaultShow, [defaultShow]);

  useEffect(() => {
    revealWorkspaceKey(workspaceId).then(setKey);
  }, [setKey, workspaceId]);

  if (key == null) return null;

  return (
    <div
      className={classNames(
        'w-full border border-border rounded-md pl-3 py-2 p-1',
        'grid gap-1 grid-cols-[minmax(0,1fr)_auto] items-center',
        'group',
      )}
    >
      <VStack space={0.5}>
        <span className="text-sm text-primary">workspace encryption key</span>
        {key && <HighlightedKey keyText={key} show={show} />}
      </VStack>
      <HStack>
        {key && (
          <CopyIconButton
            className="hidden group-hover:block"
            text={key}
            title="Copy workspace key"
          />
        )}
        <IconButton
          title={show ? 'Hide' : 'Reveal' + 'workspace key'}
          icon={show ? 'eye_closed' : 'eye'}
          onClick={() => setShow((v) => !v)}
        ></IconButton>
      </HStack>
    </div>
  );
}

function HighlightedKey({ keyText, show }: { keyText: string; show: boolean }) {
  return (
    <span className="text-xs font-mono [&_*]:cursor-auto [&_*]:select-text">
      {show ? (
        keyText.split('').map((c, i) => {
          return (
            <span
              key={i}
              className={classNames(
                c.match(/[0-9]/) && 'text-info',
                c == '-' && 'text-text-subtle',
              )}
            >
              {c}
            </span>
          );
        })
      ) : (
        <span className="text-text-subtle">{keyText.replace(/./g, '•')}</span>
      )}
    </span>
  );
}
