import type { Folder } from '@yaakapp-internal/models';
import { foldersAtom, patchModel } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { useState } from 'react';
import { useHttpAuthenticationSummaries } from '../hooks/useHttpAuthentication';
import { Input } from './core/Input';
import { VStack } from './core/Stacks';
import { TabContent, Tabs } from './core/Tabs/Tabs';
import { HeadersEditor } from './HeadersEditor';
import { HttpAuthenticationEditor } from './HttpAuthenticationEditor';
import { MarkdownEditor } from './MarkdownEditor';

interface Props {
  folderId: string | null;
}

const TAB_AUTH = 'auth';
const TAB_HEADERS = 'headers';
const TAB_GENERAL = 'general';

export function FolderSettingsDialog({ folderId }: Props) {
  const authentication = useHttpAuthenticationSummaries();

  const folders = useAtomValue(foldersAtom);
  const folder = folders.find((f) => f.id === folderId);
  const [activeTab, setActiveTab] = useState<string>(TAB_GENERAL);

  if (folder == null) return null;

  return (
    <Tabs
      value={activeTab}
      onChangeValue={setActiveTab}
      label="Folder Settings"
      className="px-1.5 pb-2"
      addBorders
      tabs={[
        {
          value: TAB_GENERAL,
          label: 'General',
        },
        {
          value: TAB_AUTH,
          label: 'Auth',
          options: {
            value: folder.authenticationType,
            items: [
              ...authentication.map((a) => ({
                label: a.label || 'UNKNOWN',
                shortLabel: a.shortLabel,
                value: a.name,
              })),
              { type: 'separator' },
              { label: 'Inherit from Parent', shortLabel: 'Auth', value: null },
              { label: 'No Auth', shortLabel: 'No Auth', value: 'none' },
            ],
            onChange: async (authenticationType) => {
              let authentication: Folder['authentication'] = folder.authentication;
              if (folder.authenticationType !== authenticationType) {
                authentication = {
                  // Reset auth if changing types
                };
              }
              await patchModel(folder, { authentication, authenticationType });
            },
          },
        },
        {
          value: TAB_HEADERS,
          label: 'Headers',
        },
      ]}
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
          forceUpdateKey={folder.id}
          headers={folder.headers}
          onChange={(headers) => patchModel(folder, { headers })}
          stateKey={`headers.${folder.id}`}
        />
      </TabContent>
    </Tabs>
  );
}
