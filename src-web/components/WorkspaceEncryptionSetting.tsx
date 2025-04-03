import { enableEncryption, revealWorkspaceKey, setWorkspaceKey } from '@yaakapp-internal/crypto';
import type { Workspace, WorkspaceMeta } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { useEffect, useState } from 'react';
import { createFastMutation } from '../hooks/useFastMutation';
import { useStateWithDeps } from '../hooks/useStateWithDeps';
import { CopyIconButton } from './CopyIconButton';
import type { ButtonProps } from './core/Button';
import { Button } from './core/Button';
import { IconButton } from './core/IconButton';
import { InlineCode } from './core/InlineCode';
import { Label } from './core/Label';
import { PlainInput } from './core/PlainInput';
import { HStack, VStack } from './core/Stacks';
import { Prose } from './Prose';

interface Props {
  workspaceMeta: WorkspaceMeta;
  workspace: Workspace;
  size?: ButtonProps['size'];
}

export function WorkspaceEncryptionSetting({ workspace, workspaceMeta, size }: Props) {
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
    <VStack space={1}>
      <Label
        htmlFor={null}
        help={
          <Prose>
            <p>Enabling workspace encryption enabled the following features:</p>
            <ul>
              <li>
                Use the <InlineCode>secure(...)</InlineCode> template function
              </li>
              <li>Store responses encrypted</li>
              <li>Store cookies encrypted</li>
              <li>Store auth tokens encrypted</li>
              <li>
                <span className="text-text-subtle">(optional)</span> Encrypt directory sync
              </li>
              <li>
                <span className="text-text-subtle">(optional)</span> Encrypt data exports
              </li>
            </ul>
            <p>
              Encryption keys are unique per workspace and are stored encrypted, using a master key
              from your OS keychain.
            </p>
          </Prose>
        }
      >
        Workspace encryption
      </Label>
      <Button
        color="secondary"
        size={size}
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
