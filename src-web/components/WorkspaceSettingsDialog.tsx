import { patchModel, workspaceMetasAtom, workspacesAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { useState } from 'react';
import { useAuthTab } from '../hooks/useAuthTab';
import { useHeadersTab } from '../hooks/useHeadersTab';
import { useInheritedHeaders } from '../hooks/useInheritedHeaders';
import { deleteModelWithConfirm } from '../lib/deleteModelWithConfirm';
import { router } from '../lib/router';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import { InlineCode } from './core/InlineCode';
import { PlainInput } from './core/PlainInput';
import { Separator } from './core/Separator';
import { HStack, VStack } from './core/Stacks';
import { TabContent, Tabs } from './core/Tabs/Tabs';
import { HeadersEditor } from './HeadersEditor';
import { HttpAuthenticationEditor } from './HttpAuthenticationEditor';
import { MarkdownEditor } from './MarkdownEditor';
import { SyncToFilesystemSetting } from './SyncToFilesystemSetting';
import { WorkspaceEncryptionSetting } from './WorkspaceEncryptionSetting';

interface Props {
  workspaceId: string | null;
  hide: () => void;
  tab?: WorkspaceSettingsTab;
}

const TAB_AUTH = 'auth';
const TAB_DESCRIPTION = 'description';
const TAB_HEADERS = 'headers';
const TAB_GENERAL = 'general';

export type WorkspaceSettingsTab =
  | typeof TAB_AUTH
  | typeof TAB_HEADERS
  | typeof TAB_GENERAL
  | typeof TAB_DESCRIPTION;

const DEFAULT_TAB: WorkspaceSettingsTab = TAB_DESCRIPTION;

export function WorkspaceSettingsDialog({ workspaceId, hide, tab }: Props) {
  const workspace = useAtomValue(workspacesAtom).find((w) => w.id === workspaceId);
  const workspaceMeta = useAtomValue(workspaceMetasAtom).find((m) => m.workspaceId === workspaceId);
  const [activeTab, setActiveTab] = useState<string>(tab ?? DEFAULT_TAB);
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
      value={activeTab}
      onChangeValue={setActiveTab}
      label="Folder Settings"
      className="px-1.5 pb-2"
      addBorders
      tabs={[
        { value: TAB_DESCRIPTION, label: 'Description' },
        {
          value: TAB_GENERAL,
          label: 'General',
        },
        ...authTab,
        ...headersTab,
      ]}
    >
      <TabContent value={TAB_AUTH} className="pt-3 overflow-y-auto h-full px-4">
        <HttpAuthenticationEditor model={workspace} />
      </TabContent>
      <TabContent value={TAB_HEADERS} className="pt-3 overflow-y-auto h-full px-4">
        <HeadersEditor
          inheritedHeaders={inheritedHeaders}
          forceUpdateKey={workspace.id}
          headers={workspace.headers}
          onChange={(headers) => patchModel(workspace, { headers })}
          stateKey={`headers.${workspace.id}`}
        />
      </TabContent>
      <TabContent value={TAB_DESCRIPTION} className="pt-3 overflow-y-auto h-full px-4">
        <VStack space={4} alignItems="start" className="pb-3 h-full">
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
        </VStack>
      </TabContent>
      <TabContent value={TAB_GENERAL} className="pt-3 overflow-y-auto h-full px-4">
        <VStack space={4} alignItems="start" className="pb-3 h-full">
          <SyncToFilesystemSetting
            value={{ filePath: workspaceMeta.settingSyncDir }}
            onCreateNewWorkspace={hide}
            onChange={({ filePath }) => patchModel(workspaceMeta, { settingSyncDir: filePath })}
          />
          <WorkspaceEncryptionSetting size="xs" />

          <Separator className="my-4" />

          <HStack alignItems="center" justifyContent="between" className="w-full">
            <Button
              onClick={async () => {
                const didDelete = await deleteModelWithConfirm(workspace);
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
            <InlineCode className="select-text cursor-text">{workspaceId}</InlineCode>
          </HStack>
        </VStack>
      </TabContent>
    </Tabs>
  );
}
