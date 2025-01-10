import { revealItemInDir } from '@tauri-apps/plugin-opener';
import React from 'react';
import { upsertWorkspace } from '../../commands/upsertWorkspace';
import { useActiveWorkspace } from '../../hooks/useActiveWorkspace';
import { useAppInfo } from '../../hooks/useAppInfo';
import { useCheckForUpdates } from '../../hooks/useCheckForUpdates';
import { useSettings } from '../../hooks/useSettings';
import { useUpdateSettings } from '../../hooks/useUpdateSettings';
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
  const workspace = useActiveWorkspace();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const appInfo = useAppInfo();
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
          labelClassName="w-[12rem]"
          size="sm"
          value={settings.updateChannel}
          onChange={(updateChannel) => updateSettings.mutate({ updateChannel })}
          event="update-channel"
          options={[
            { label: 'Stable (less frequent)', value: 'stable' },
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
        name="switchWorkspaceBehavior"
        label="Switch Workspace Behavior"
        labelPosition="left"
        labelClassName="w-[12rem]"
        size="sm"
        event="workspace-switch-behavior"
        value={
          settings.openWorkspaceNewWindow === true
            ? 'new'
            : settings.openWorkspaceNewWindow === false
              ? 'current'
              : 'ask'
        }
        onChange={(v) => {
          if (v === 'current') updateSettings.mutate({ openWorkspaceNewWindow: false });
          else if (v === 'new') updateSettings.mutate({ openWorkspaceNewWindow: true });
          else updateSettings.mutate({ openWorkspaceNewWindow: null });
        }}
        options={[
          { label: 'Always Ask', value: 'ask' },
          { label: 'Current Window', value: 'current' },
          { label: 'New Window', value: 'new' },
        ]}
      />

      <Checkbox
        className="mt-3"
        checked={settings.telemetry}
        title="Send Usage Statistics"
        event="usage-statistics"
        onChange={(telemetry) => updateSettings.mutate({ telemetry })}
      />

      <Separator className="my-4" />

      <Heading size={2}>
        Workspace{' '}
        <div className="inline-block ml-1 bg-surface-highlight px-2 py-0.5 rounded text text-shrink">
          {workspace.name}
        </div>
      </Heading>
      <VStack className="mt-1 w-full" space={3}>
        <PlainInput
          size="sm"
          name="requestTimeout"
          label="Request Timeout (ms)"
          placeholder="0"
          labelPosition="left"
          defaultValue={`${workspace.settingRequestTimeout}`}
          validate={(value) => parseInt(value) >= 0}
          onChange={(v) =>
            upsertWorkspace.mutate({ ...workspace, settingRequestTimeout: parseInt(v) || 0 })
          }
          type="number"
        />

        <Checkbox
          checked={workspace.settingValidateCertificates}
          title="Validate TLS Certificates"
          event="validate-certs"
          onChange={(settingValidateCertificates) =>
            upsertWorkspace.mutate({ ...workspace, settingValidateCertificates })
          }
        />

        <Checkbox
          checked={workspace.settingFollowRedirects}
          title="Follow Redirects"
          event="follow-redirects"
          onChange={(settingFollowRedirects) =>
            upsertWorkspace.mutate({
              ...workspace,
              settingFollowRedirects,
            })
          }
        />
      </VStack>

      <Separator className="my-4" />

      <Heading size={2}>App Info</Heading>
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
