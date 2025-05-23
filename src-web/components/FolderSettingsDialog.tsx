import { foldersAtom, patchModel } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { useMemo, useState } from 'react';
import { useAuthTab } from '../hooks/useAuthTab';
import { useHeadersTab } from '../hooks/useHeadersTab';
import { useInheritedHeaders } from '../hooks/useInheritedHeaders';
import { Input } from './core/Input';
import { VStack } from './core/Stacks';
import type { TabItem } from './core/Tabs/Tabs';
import { TabContent, Tabs } from './core/Tabs/Tabs';
import { HeadersEditor } from './HeadersEditor';
import { HttpAuthenticationEditor } from './HttpAuthenticationEditor';
import { MarkdownEditor } from './MarkdownEditor';

interface Props {
  folderId: string | null;
  tab?: FolderSettingsTab;
}

const TAB_AUTH = 'auth';
const TAB_HEADERS = 'headers';
const TAB_GENERAL = 'general';

export type FolderSettingsTab = typeof TAB_AUTH | typeof TAB_HEADERS | typeof TAB_GENERAL;

export function FolderSettingsDialog({ folderId, tab }: Props) {
  const folders = useAtomValue(foldersAtom);
  const folder = folders.find((f) => f.id === folderId) ?? null;
  const [activeTab, setActiveTab] = useState<string>(tab ?? TAB_GENERAL);
  const authTab = useAuthTab(TAB_AUTH, folder);
  const headersTab = useHeadersTab(TAB_HEADERS, folder);
  const inheritedHeaders = useInheritedHeaders(folder);

  const tabs = useMemo<TabItem[]>(() => {
    if (folder == null) return [];

    return [
      {
        value: TAB_GENERAL,
        label: 'General',
      },
      ...authTab,
      ...headersTab,
    ];
  }, [authTab, folder, headersTab]);

  if (folder == null) return null;

  return (
    <Tabs
      value={activeTab}
      onChangeValue={setActiveTab}
      label="Folder Settings"
      className="px-1.5 pb-2"
      addBorders
      tabs={tabs}
    >
      <TabContent value={TAB_AUTH} className="pt-3 overflow-y-auto h-full px-4">
        <HttpAuthenticationEditor model={folder} />
      </TabContent>
      <TabContent value={TAB_GENERAL} className="pt-3 overflow-y-auto h-full px-4">
        <VStack space={3} className="pb-3">
          <Input
            label="Folder Name"
            defaultValue={folder.name}
            onChange={(name) => patchModel(folder, { name })}
            stateKey={`name.${folder.id}`}
          />

          <MarkdownEditor
            name="folder-description"
            placeholder="Folder description"
            className="min-h-[10rem] border border-border px-2"
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
    </Tabs>
  );
}
