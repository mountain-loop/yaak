import {
  createWorkspaceModel,
  foldersAtom,
  patchModel,
  workspacesAtom,
} from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { Fragment, useMemo, useState } from 'react';
import { useAuthTab } from '../hooks/useAuthTab';
import { useEnvironmentsBreakdown } from '../hooks/useEnvironmentsBreakdown';
import { useHeadersTab } from '../hooks/useHeadersTab';
import { useInheritedHeaders } from '../hooks/useInheritedHeaders';
import { useParentFolders } from '../hooks/useParentFolders';
import { Button } from './core/Button';
import { CountBadge } from './core/CountBadge';
import { Icon } from './core/Icon';
import { Input } from './core/Input';
import { Link } from './core/Link';
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

export type FolderSettingsTab =
  | typeof TAB_AUTH
  | typeof TAB_HEADERS
  | typeof TAB_GENERAL
  | typeof TAB_VARIABLES;

export function FolderSettingsDialog({ folderId, tab }: Props) {
  const folders = useAtomValue(foldersAtom);
  const workspaces = useAtomValue(workspacesAtom);
  const folder = folders.find((f) => f.id === folderId) ?? null;
  const parentFolders = useParentFolders(folder);
  const [activeTab, setActiveTab] = useState<string>(tab ?? TAB_GENERAL);
  const authTab = useAuthTab(TAB_AUTH, folder);
  const headersTab = useHeadersTab(TAB_HEADERS, folder);
  const inheritedHeaders = useInheritedHeaders(folder);
  const environments = useEnvironmentsBreakdown();
  const folderEnvironment = environments.allEnvironments.find(
    (e) => e.parentModel === 'folder' && e.parentId === folderId,
  );
  const numVars = (folderEnvironment?.variables ?? []).filter((v) => v.name).length;

  const breadcrumbs = useMemo(() => {
    if (!folder) return [];

    const workspace = workspaces.find((w) => w.id === folder.workspaceId);

    const items = [];
    if (workspace) {
      items.push({ id: workspace.id, name: workspace.name });
    }
    items.push(...parentFolders.reverse().map((f) => ({ id: f.id, name: f.name })));

    return items;
  }, [folder, parentFolders, workspaces]);

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
        rightSlot: numVars > 0 ? <CountBadge count={numVars} /> : null,
      },
    ];
  }, [authTab, folder, headersTab, numVars]);

  if (folder == null) return null;

  return (
    <Tabs
      value={activeTab}
      onChangeValue={setActiveTab}
      label="Folder Settings"
      className="pt-2 pb-2 pl-3 pr-1"
      layout="horizontal"
      addBorders
      tabs={tabs}
    >
      <TabContent value={TAB_AUTH} className="overflow-y-auto h-full px-4">
        <HttpAuthenticationEditor model={folder} />
      </TabContent>
      <TabContent value={TAB_GENERAL} className="overflow-y-auto h-full px-4">
        <VStack space={3} className="pb-3 h-full">
          {breadcrumbs.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-medium text-text-subtle uppercase tracking-wide">
                Location
              </div>
              <div className="flex items-center gap-1.5 text-sm text-text-subtlest px-2 py-1.5 bg-surface rounded border border-border">
                {breadcrumbs.map((item, index) => (
                  <Fragment key={item.id}>
                    {index > 0 && <Icon icon="chevron_right" size="sm" className="opacity-50" />}
                    <span className={index === breadcrumbs.length - 1 ? 'text-text-subtle' : ''}>
                      {item.name}
                    </span>
                  </Fragment>
                ))}
              </div>
            </div>
          )}
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
      <TabContent value={TAB_HEADERS} className="overflow-y-auto h-full px-4">
        <HeadersEditor
          inheritedHeaders={inheritedHeaders}
          forceUpdateKey={folder.id}
          headers={folder.headers}
          onChange={(headers) => patchModel(folder, { headers })}
          stateKey={`headers.${folder.id}`}
        />
      </TabContent>
      <TabContent value={TAB_VARIABLES} className="overflow-y-auto h-full px-4">
        {folderEnvironment == null ? (
          <EmptyStateText>
            <VStack alignItems="center" space={1.5}>
              <p>
                Override{' '}
                <Link href="https://feedback.yaak.app/help/articles/3284139-environments-and-variables">
                  Variables
                </Link>{' '}
                for requests within this folder.
              </p>
              <Button
                variant="border"
                size="sm"
                onClick={async () => {
                  await createWorkspaceModel({
                    workspaceId: folder.workspaceId,
                    parentModel: 'folder',
                    parentId: folder.id,
                    model: 'environment',
                    name: 'Folder Environment',
                  });
                }}
              >
                Create Folder Environment
              </Button>
            </VStack>
          </EmptyStateText>
        ) : (
          <EnvironmentEditor hideName environment={folderEnvironment} />
        )}
      </TabContent>
    </Tabs>
  );
}
