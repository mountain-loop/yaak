import { patchModel, workspaceMetasAtom, workspacesAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { useAuthTab } from '../hooks/useAuthTab';
import { useHeadersTab } from '../hooks/useHeadersTab';
import { useInheritedHeaders } from '../hooks/useInheritedHeaders';
import { deleteModelWithConfirm } from '../lib/deleteModelWithConfirm';
import { router } from '../lib/router';
import { CopyIconButton } from './CopyIconButton';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import { CountBadge } from './core/CountBadge';
import { InlineCode } from './core/InlineCode';
import { PlainInput } from './core/PlainInput';
import { HStack, VStack } from './core/Stacks';
import { TabContent, Tabs } from './core/Tabs/Tabs';
import { DnsOverridesEditor } from './DnsOverridesEditor';
import { HeadersEditor } from './HeadersEditor';
import { HttpAuthenticationEditor } from './HttpAuthenticationEditor';
import { MarkdownEditor } from './MarkdownEditor';
import { SyncToFilesystemSetting } from './SyncToFilesystemSetting';
import { WorkspaceEncryptionSetting } from './WorkspaceEncryptionSetting';

interface Props {
  workspaceId: string;
  hide: () => void;
  tab?: WorkspaceSettingsTab;
}

const TAB_AUTH = 'auth';
const TAB_DATA = 'data';
const TAB_DNS = 'dns';
const TAB_HEADERS = 'headers';
const TAB_GENERAL = 'general';

export type WorkspaceSettingsTab =
  | typeof TAB_AUTH
  | typeof TAB_DNS
  | typeof TAB_HEADERS
  | typeof TAB_GENERAL
  | typeof TAB_DATA;

const DEFAULT_TAB: WorkspaceSettingsTab = TAB_GENERAL;

export function WorkspaceSettingsDialog({ workspaceId, hide, tab }: Props) {
  const workspace = useAtomValue(workspacesAtom).find((w) => w.id === workspaceId);
  const workspaceMeta = useAtomValue(workspaceMetasAtom).find((m) => m.workspaceId === workspaceId);
  const authTab = useAuthTab(TAB_AUTH, workspace ?? null);
  const headersTab = useHeadersTab(TAB_HEADERS, workspace ?? null);
  const inheritedHeaders = useInheritedHeaders(workspace ?? null);

  if (workspace == null) {
    return (
      <Banner color="danger">
        <InlineCode>Workspace</InlineCode> not found
      </Banner>
    );
  }

  if (workspaceMeta == null)
    return (
      <Banner color="danger">
        <InlineCode>WorkspaceMeta</InlineCode> not found for workspace
      </Banner>
    );

  return (
    <Tabs
      defaultValue={tab ?? DEFAULT_TAB}
      label="Folder Settings"
      className="pt-4 pb-2 px-3"
      tabListClassName="pl-4"
      addBorders
      tabs={[
        { value: TAB_GENERAL, label: 'Workspace' },
        {
          value: TAB_DATA,
          label: 'Storage',
        },
        ...headersTab,
        ...authTab,
        {
          value: TAB_DNS,
          label: 'DNS',
          rightSlot:
            workspace.settingDnsOverrides.length > 0 ? (
              <CountBadge count={workspace.settingDnsOverrides.length} />
            ) : null,
        },
      ]}
      storageKey="workspace_settings_tabs"
    >
      <TabContent value={TAB_AUTH} className="overflow-y-auto h-full px-4">
        <HttpAuthenticationEditor model={workspace} />
      </TabContent>
      <TabContent value={TAB_HEADERS} className="overflow-y-auto h-full px-4">
        <HeadersEditor
          inheritedHeaders={inheritedHeaders}
          inheritedHeadersLabel="Defaults"
          forceUpdateKey={workspace.id}
          headers={workspace.headers}
          onChange={(headers) => patchModel(workspace, { headers })}
          stateKey={`headers.${workspace.id}`}
        />
      </TabContent>
      <TabContent value={TAB_GENERAL} className="overflow-y-auto h-full px-4">
        <div className="grid grid-rows-[auto_minmax(0,1fr)_auto] gap-4 pb-3 h-full">
          <PlainInput
            required
            hideLabel
            placeholder="Workspace Name"
            label="Name"
            defaultValue={workspace.name}
            className="!text-base font-sans"
            onChange={(name) => patchModel(workspace, { name })}
          />

          <MarkdownEditor
            name="workspace-description"
            placeholder="Workspace description"
            className="border border-border px-2"
            defaultValue={workspace.description}
            stateKey={`description.${workspace.id}`}
            onChange={(description) => patchModel(workspace, { description })}
            heightMode="auto"
          />

          <HStack alignItems="center" justifyContent="between" className="w-full">
            <Button
              onClick={async () => {
                const didDelete = await deleteModelWithConfirm(workspace, {
                  confirmName: workspace.name,
                });
                if (didDelete) {
                  hide(); // Only hide if actually deleted workspace
                  await router.navigate({ to: '/' });
                }
              }}
              color="danger"
              variant="border"
              size="xs"
            >
              Delete Workspace
            </Button>
            <InlineCode className="flex gap-1 items-center text-primary pl-2.5">
              {workspaceId}
              <CopyIconButton
                className="opacity-70 !text-primary"
                size="2xs"
                iconSize="sm"
                title="Copy workspace ID"
                text={workspaceId}
              />
            </InlineCode>
          </HStack>
        </div>
      </TabContent>
      <TabContent value={TAB_DATA} className="overflow-y-auto h-full px-4">
        <VStack space={4} alignItems="start" className="pb-3 h-full">
          <SyncToFilesystemSetting
            value={{ filePath: workspaceMeta.settingSyncDir }}
            onCreateNewWorkspace={hide}
            onChange={({ filePath }) => patchModel(workspaceMeta, { settingSyncDir: filePath })}
          />
          <WorkspaceEncryptionSetting size="xs" />
        </VStack>
      </TabContent>
      <TabContent value={TAB_DNS} className="overflow-y-auto h-full px-4">
        <DnsOverridesEditor workspace={workspace} />
      </TabContent>
    </Tabs>
  );
}
