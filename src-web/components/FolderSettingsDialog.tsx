import { createWorkspaceModel, foldersAtom, patchModel } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { useMemo, useState } from 'react';
import { useAuthTab } from '../hooks/useAuthTab';
import { useEnvironmentsBreakdown } from '../hooks/useEnvironmentsBreakdown';
import { useHeadersTab } from '../hooks/useHeadersTab';
import { useInheritedHeaders } from '../hooks/useInheritedHeaders';
import { Button } from './core/Button';
import { Input } from './core/Input';
import { VStack } from './core/Stacks';
import type { TabItem } from './core/Tabs/Tabs';
import { TabContent, Tabs } from './core/Tabs/Tabs';
import { EmptyStateText } from './EmptyStateText';
import { EnvironmentEditor } from './EnvironmentEditor';
import { HeadersEditor } from './HeadersEditor';
import { HttpAuthenticationEditor } from './HttpAuthenticationEditor';
import { MarkdownEditor } from './MarkdownEditor';

interface Props {
  folderId: string | null;
  tab?: FolderSettingsTab;
}

const TAB_AUTH = 'auth';
const TAB_HEADERS = 'headers';
const TAB_VARIABLES = 'variables';
const TAB_GENERAL = 'general';

export type FolderSettingsTab = typeof TAB_AUTH | typeof TAB_HEADERS | typeof TAB_GENERAL;

export function FolderSettingsDialog({ folderId, tab }: Props) {
  const folders = useAtomValue(foldersAtom);
  const folder = folders.find((f) => f.id === folderId) ?? null;
  const [activeTab, setActiveTab] = useState<string>(tab ?? TAB_GENERAL);
  const authTab = useAuthTab(TAB_AUTH, folder);
  const headersTab = useHeadersTab(TAB_HEADERS, folder);
  const inheritedHeaders = useInheritedHeaders(folder);
  const environments = useEnvironmentsBreakdown();
  const folderEnvironment = environments.allEnvironments.find(
    (e) => e.parentModel === 'folder' && e.parentId === folderId,
  );

  const handleActiveTabChange = (tab: string) => {
    setActiveTab(tab);
    if (tab === TAB_VARIABLES && folderEnvironment == null) {
      console.log('CREATE FOLDER ENVIRONMENT');
    }
  };

  const tabs = useMemo<TabItem[]>(() => {
    if (folder == null) return [];

    return [
      {
        value: TAB_GENERAL,
        label: 'General',
      },
      ...headersTab,
      ...authTab,
      {
        value: TAB_VARIABLES,
        label: 'Variables',
      },
    ];
  }, [authTab, folder, headersTab]);

  if (folder == null) return null;

  return (
    <Tabs
      value={activeTab}
      onChangeValue={handleActiveTabChange}
      label="Folder Settings"
      className="px-1.5 pb-2"
      addBorders
      tabs={tabs}
    >
      <TabContent value={TAB_AUTH} className="pt-3 overflow-y-auto h-full px-4">
        <HttpAuthenticationEditor model={folder} />
      </TabContent>
      <TabContent value={TAB_GENERAL} className="pt-3 overflow-y-auto h-full px-4">
        <VStack space={3} className="pb-3 h-full">
          <Input
            label="Folder Name"
            defaultValue={folder.name}
            onChange={(name) => patchModel(folder, { name })}
            stateKey={`name.${folder.id}`}
          />
          <MarkdownEditor
            name="folder-description"
            placeholder="Folder description"
            className="border border-border px-2"
            defaultValue={folder.description}
            stateKey={`description.${folder.id}`}
            onChange={(description) => patchModel(folder, { description })}
          />
        </VStack>
      </TabContent>
      <TabContent value={TAB_HEADERS} className="pt-3 overflow-y-auto h-full px-4">
        <HeadersEditor
          inheritedHeaders={inheritedHeaders}
          forceUpdateKey={folder.id}
          headers={folder.headers}
          onChange={(headers) => patchModel(folder, { headers })}
          stateKey={`headers.${folder.id}`}
        />
      </TabContent>
      <TabContent value={TAB_VARIABLES} className="pt-3 overflow-y-auto h-full px-4">
        {folderEnvironment == null ? (
          <EmptyStateText>
            <VStack alignItems="center" space={1.5}>
              <p>Folder environment not found for folder</p>
              <Button
                variant="border"
                size="sm"
                onClick={async () => {
                  await createWorkspaceModel({
                    workspaceId: folder.workspaceId,
                    parentModel: 'folder',
                    parentId: folder.id,
                    model: 'environment',
                  });
                }}
              >
                Create Folder Environment
              </Button>
            </VStack>
          </EmptyStateText>
        ) : (
          <EnvironmentEditor environment={folderEnvironment} />
        )}
      </TabContent>
    </Tabs>
  );
}
