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
import { IconButton } from './core/IconButton';
import { IconTooltip } from './core/IconTooltip';
import { Label } from './core/Label';
import { PlainInput } from './core/PlainInput';
import { HStack, VStack } from './core/Stacks';
import { EncryptionHelp } from './EncryptionHelp';

interface Props {
  size?: ButtonProps['size'];
  expanded?: boolean;
  onDone?: () => void;
  onEnabledEncryption?: () => void;
}

export function WorkspaceEncryptionSetting({ size, expanded, onDone, onEnabledEncryption }: Props) {
  const [justEnabledEncryption, setJustEnabledEncryption] = useState<boolean>(false);

  const workspace = useAtomValue(activeWorkspaceAtom);
  const workspaceMeta = useAtomValue(activeWorkspaceMetaAtom);

  if (workspace == null || workspaceMeta == null) {
    return null;
  }

  if (workspace.encryptionKeyChallenge && workspaceMeta.encryptionKey == null) {
    return (
      <EnterWorkspaceKey
        workspaceMeta={workspaceMeta}
        onEnabled={() => {
          onDone?.();
          onEnabledEncryption?.();
        }}
      />
    );
  }

  if (workspaceMeta.encryptionKey) {
    const keyRevealer = (
      <KeyRevealer
        disableLabel={justEnabledEncryption}
        defaultShow={justEnabledEncryption}
        workspaceId={workspaceMeta.workspaceId}
      />
    );
    return (
      <VStack space={2} className="w-full">
        {justEnabledEncryption && (
          <Banner color="success" className="flex flex-col gap-2">
            {helpAfterEncryption}
          </Banner>
        )}
        {keyRevealer}
        {onDone && (
          <Button color="secondary" onClick={() => {
              onDone();
              onEnabledEncryption?.();
          }}>
            Done
          </Button>
        )}
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
          <EncryptionHelp />
        </Banner>
      ) : (
        <Label htmlFor={null} help={<EncryptionHelp />}>
          Workspace encryption
        </Label>
      )}
    </div>
  );
}

const setWorkspaceKeyMut = createFastMutation({
  mutationKey: ['set-workspace-key'],
  mutationFn: setWorkspaceKey,
});

function EnterWorkspaceKey({
  workspaceMeta,
  onEnabled,
}: {
  workspaceMeta: WorkspaceMeta;
  onEnabled?: () => void;
}) {
  const [key, setKey] = useState<string>('');
  return (
    <VStack space={4}>
      <Banner color="info">
        This workspace contains encrypted values but no key is configured. Please enter the
        workspace key to access the encrypted data.
      </Banner>
      <HStack
        as="form"
        alignItems="end"
        className="w-full"
        space={1.5}
        onSubmit={(e) => {
          e.preventDefault();
          setWorkspaceKeyMut.mutate(
            {
              workspaceId: workspaceMeta.workspaceId,
              key: key.trim(),
            },
            { onSuccess: onEnabled },
          );
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
    </VStack>
  );
}

function KeyRevealer({
  workspaceId,
  defaultShow = false,
  disableLabel = false,
}: {
  workspaceId: string;
  defaultShow?: boolean;
  disableLabel?: boolean;
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
        {!disableLabel && (
          <span className="text-sm text-primary flex items-center gap-1">
            workspace encryption key{' '}
            <IconTooltip iconSize="sm" size="lg" content={helpAfterEncryption} />
          </span>
        )}
        {key && <HighlightedKey keyText={key} show={show} />}
      </VStack>
      <HStack>
        {key && <CopyIconButton text={key} title="Copy workspace key" />}
        <IconButton
          title={show ? 'Hide' : 'Reveal' + 'workspace key'}
          icon={show ? 'eye_closed' : 'eye'}
          onClick={() => setShow((v) => !v)}
        />
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

const helpAfterEncryption = (
  <p>
    this key is used for any encryption used for this workspace. It is stored securely using your OS
    keychain, but it is recommended to back it up. If you share this workspace with others,
    you&apos;ll need to send them this key to access any encrypted values.
  </p>
);
