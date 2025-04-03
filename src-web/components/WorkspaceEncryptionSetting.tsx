import { enableEncryption, revealWorkspaceKey, setWorkspaceKey } from '@yaakapp-internal/crypto';
import type { WorkspaceMeta } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { useAtomValue } from 'jotai/index';
import { useEffect, useState } from 'react';
import { activeWorkspaceAtom, activeWorkspaceMetaAtom } from '../hooks/useActiveWorkspace';
import { createFastMutation } from '../hooks/useFastMutation';
import { useStateWithDeps } from '../hooks/useStateWithDeps';
import { CopyIconButton } from './CopyIconButton';
import { Banner } from './core/Banner';
import type { ButtonProps } from './core/Button';
import { Button } from './core/Button';
import { Icon } from './core/Icon';
import { IconButton } from './core/IconButton';
import { IconTooltip } from './core/IconTooltip';
import { InlineCode } from './core/InlineCode';
import { Label } from './core/Label';
import { PlainInput } from './core/PlainInput';
import { HStack, VStack } from './core/Stacks';
import { Prose } from './Prose';

interface Props {
  size?: ButtonProps['size'];
  expanded?: boolean;
}

export function WorkspaceEncryptionSetting({ size, expanded }: Props) {
  const [justEnabledEncryption, setJustEnabledEncryption] = useState<boolean>(false);

  const workspace = useAtomValue(activeWorkspaceAtom);
  const workspaceMeta = useAtomValue(activeWorkspaceMetaAtom);

  if (workspace == null || workspaceMeta == null) {
    return null;
  }

  if (workspace.encryptionKeyChallenge && workspaceMeta.encryptionKey == null) {
    return <EnterWorkspaceKey workspaceMeta={workspaceMeta} />;
  }

  if (workspaceMeta.encryptionKey) {
    const keyRevealer = (
      <KeyRevealer defaultShow={justEnabledEncryption} workspaceId={workspaceMeta.workspaceId} />
    );
    return (
      <VStack space={2} className="w-full">
        {justEnabledEncryption && (
          <Banner color="danger" className="flex flex-col gap-2">
            <h2 className="font-bold flex items-center gap-1">
              <Icon icon="circle_alert" className="inline-block" /> Keep this key safe
            </h2>
            <p className="opacity-70">
              This key is needed to decrypt this workspace on other devices, so store it securely
              for access by your or your team later.
            </p>
            <p className="opacity-70">It will also be available in the workspace settings.</p>
          </Banner>
        )}
        {keyRevealer}
      </VStack>
    );
  }

  return (
    <div className="mb-auto flex flex-col-reverse">
      <Button
        color={expanded ? 'info' : 'secondary'}
        size={size}
        onClick={async () => {
          setJustEnabledEncryption(true);
          await enableEncryption(workspaceMeta.workspaceId);
        }}
      >
        Enable Encryption
      </Button>
      {expanded ? (
        <Banner color="info" className="mb-6">
          {help}
        </Banner>
      ) : (
        <Label htmlFor={null} help={help}>
          Workspace encryption
        </Label>
      )}
    </div>
  );
}

const help = (
  <Prose>
    <p>Workspace encryption enables the following.</p>
    <ul>
      <li>
        Use the <InlineCode>secure(...)</InlineCode> template function
      </li>
      <li>Encrypt responses, cookies, and other credentials</li>
      <li>
        <span className="text-text-subtle">(optional)</span> Encrypted directory sync
      </li>
      <li>
        <span className="text-text-subtle">(optional)</span> Encrypted data exports
      </li>
    </ul>
    <p>
      Encryption keys are unique per workspace and are stored encrypted using a master key located
      in your OS keychain.
    </p>
  </Prose>
);

const setWorkspaceKeyMut = createFastMutation({
  mutationKey: ['set-workspace-key'],
  mutationFn: setWorkspaceKey,
});

function EnterWorkspaceKey({ workspaceMeta }: { workspaceMeta: WorkspaceMeta }) {
  const [key, setKey] = useState<string>('');
  return (
    <HStack
      as="form"
      alignItems="end"
      className="w-full"
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
      )}
    >
      <VStack space={0.5}>
        <span className="text-sm text-primary flex items-center gap-1">
          workspace encryption key <IconTooltip size="sm" content={help} />
        </span>
        {key && <HighlightedKey keyText={key} show={show} />}
      </VStack>
      <HStack>
        {key && <CopyIconButton text={key} title="Copy workspace key" />}
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
        <div className="text-text-subtle">•••••••••••••••••••••</div>
      )}
    </span>
  );
}
