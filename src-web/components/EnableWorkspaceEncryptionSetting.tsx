import { enableEncryption, revealWorkspaceKey, setWorkspaceKey } from '@yaakapp-internal/crypto';
import type { Workspace, WorkspaceMeta } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { useEffect, useState } from 'react';
import { createFastMutation } from '../hooks/useFastMutation';
import { useStateWithDeps } from '../hooks/useStateWithDeps';
import { CopyIconButton } from './CopyIconButton';
import { Button } from './core/Button';
import { IconButton } from './core/IconButton';
import { PlainInput } from './core/PlainInput';
import { HStack, VStack } from './core/Stacks';

interface Props {
  workspaceMeta: WorkspaceMeta;
  workspace: Workspace;
}

export function EnableWorkspaceEncryptionSetting({ workspace, workspaceMeta }: Props) {
  const [justEnabledEncryption, setJustEnabledEncryption] = useState<boolean>(false);

  if (workspace.encryptionKeyChallenge && workspaceMeta.encryptionKey == null) {
    return <EnterWorkspaceKey workspaceMeta={workspaceMeta} />;
  }

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

const setWorkspaceKeyMut = createFastMutation({
  mutationKey: ['set-workspace-key'],
  mutationFn: setWorkspaceKey,
});

function EnterWorkspaceKey({ workspaceMeta }: { workspaceMeta: WorkspaceMeta }) {
  const [key, setKey] = useState<string>('');
  return (
    <div>
      <HStack
        as="form"
        alignItems="end"
        space={1.5}
        onSubmit={(e) => {
          e.preventDefault();
          setWorkspaceKeyMut.mutate({ workspaceId: workspaceMeta.workspaceId, key: key.trim() });
        }}
      >
        <PlainInput
          required
          onChange={setKey}
          label="Workspace encryption key"
          placeholder="YK0000-111111-222222-333333-444444-AAAAAA-BBBBBB-CCCCCC-DDDDDD"
        />
        <Button variant="border" type="submit" color="secondary">
          Submit
        </Button>
      </HStack>
    </div>
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
