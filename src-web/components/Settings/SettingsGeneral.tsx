import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { patchModel, settingsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import React from 'react';
import { activeWorkspaceAtom } from '../../hooks/useActiveWorkspace';
import { appInfo } from '../../lib/appInfo';
import { useCheckForUpdates } from '../../hooks/useCheckForUpdates';
import { revealInFinderText } from '../../lib/reveal';
import { Checkbox } from '../core/Checkbox';
import { Heading } from '../core/Heading';
import { IconButton } from '../core/IconButton';
import { KeyValueRow, KeyValueRows } from '../core/KeyValueRow';
import { PlainInput } from '../core/PlainInput';
import { Select } from '../core/Select';
import { Separator } from '../core/Separator';
import { VStack } from '../core/Stacks';

export function SettingsGeneral() {
  const workspace = useAtomValue(activeWorkspaceAtom);
  const settings = useAtomValue(settingsAtom);
  const checkForUpdates = useCheckForUpdates();

  if (settings == null || workspace == null) {
    return null;
  }

  return (
    <VStack space={1.5} className="mb-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1">
        <Select
          name="updateChannel"
          label="Update Channel"
          labelPosition="left"
          labelClassName="w-[14rem]"
          size="sm"
          value={settings.updateChannel}
          onChange={(updateChannel) => patchModel(settings, { updateChannel })}
          options={[
            { label: 'Stable', value: 'stable' },
            { label: 'Beta (more frequent)', value: 'beta' },
          ]}
        />
        <IconButton
          variant="border"
          size="sm"
          title="Check for updates"
          icon="refresh"
          spin={checkForUpdates.isPending}
          onClick={() => checkForUpdates.mutateAsync()}
        />
      </div>

      <Select
        name="autoupdate"
        value={settings.autoupdate ? 'auto' : 'manual'}
        label="Update Behavior"
        labelPosition="left"
        size="sm"
        labelClassName="w-[14rem]"
        onChange={(v) => patchModel(settings, { autoupdate: v === 'auto' })}
        options={[
          { label: 'Automatic', value: 'auto' },
          { label: 'Manual', value: 'manual' },
        ]}
      />

      <Select
        name="switchWorkspaceBehavior"
        label="Workspace Window Behavior"
        labelPosition="left"
        labelClassName="w-[14rem]"
        size="sm"
        value={
          settings.openWorkspaceNewWindow === true
            ? 'new'
            : settings.openWorkspaceNewWindow === false
              ? 'current'
              : 'ask'
        }
        onChange={async (v) => {
          if (v === 'current') await patchModel(settings, { openWorkspaceNewWindow: false });
          else if (v === 'new') await patchModel(settings, { openWorkspaceNewWindow: true });
          else await patchModel(settings, { openWorkspaceNewWindow: null });
        }}
        options={[
          { label: 'Always ask', value: 'ask' },
          { label: 'Open in current window', value: 'current' },
          { label: 'Open in new window', value: 'new' },
        ]}
      />

      <Separator className="my-4" />

      <Heading level={2}>
        Workspace{' '}
        <div className="inline-block ml-1 bg-surface-highlight px-2 py-0.5 rounded text text-shrink">
          {workspace.name}
        </div>
      </Heading>
      <VStack className="mt-1 w-full" space={3}>
        <PlainInput
          required
          size="sm"
          name="requestTimeout"
          label="Request Timeout (ms)"
          labelClassName="w-[14rem]"
          placeholder="0"
          labelPosition="left"
          defaultValue={`${workspace.settingRequestTimeout}`}
          validate={(value) => parseInt(value) >= 0}
          onChange={(v) => patchModel(workspace, { settingRequestTimeout: parseInt(v) || 0 })}
          type="number"
        />

        <Checkbox
          checked={workspace.settingValidateCertificates}
          help="When disabled, skip validatation of server certificates, useful when interacting with self-signed certs."
          title="Validate TLS Certificates"
          onChange={(settingValidateCertificates) =>
            patchModel(workspace, { settingValidateCertificates })
          }
        />

        <Checkbox
          checked={workspace.settingFollowRedirects}
          title="Follow Redirects"
          onChange={(settingFollowRedirects) =>
            patchModel(workspace, {
              settingFollowRedirects,
            })
          }
        />
      </VStack>

      <Separator className="my-4" />

      <Heading level={2}>App Info</Heading>
      <KeyValueRows>
        <KeyValueRow label="Version">{appInfo.version}</KeyValueRow>
        <KeyValueRow
          label="Data Directory"
          rightSlot={
            <IconButton
              title={revealInFinderText}
              icon="folder_open"
              size="2xs"
              onClick={() => revealItemInDir(appInfo.appDataDir)}
            />
          }
        >
          {appInfo.appDataDir}
        </KeyValueRow>
        <KeyValueRow
          label="Logs Directory"
          rightSlot={
            <IconButton
              title={revealInFinderText}
              icon="folder_open"
              size="2xs"
              onClick={() => revealItemInDir(appInfo.appLogDir)}
            />
          }
        >
          {appInfo.appLogDir}
        </KeyValueRow>
      </KeyValueRows>
    </VStack>
  );
}
