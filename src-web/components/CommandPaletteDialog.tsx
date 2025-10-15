import { workspacesAtom } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { fuzzyFilter } from 'fuzzbunny';
import { useAtomValue } from 'jotai';
import type { KeyboardEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createFolder } from '../commands/commands';
import { createSubEnvironmentAndActivate } from '../commands/createEnvironment';
import { openSettings } from '../commands/openSettings';
import { switchWorkspace } from '../commands/switchWorkspace';
import { useActiveCookieJar } from '../hooks/useActiveCookieJar';
import { useActiveEnvironment } from '../hooks/useActiveEnvironment';
import { useActiveRequest } from '../hooks/useActiveRequest';
import { activeWorkspaceIdAtom } from '../hooks/useActiveWorkspace';
import { useAllRequests } from '../hooks/useAllRequests';
import { useCreateWorkspace } from '../hooks/useCreateWorkspace';
import { useDebouncedState } from '../hooks/useDebouncedState';
import { useEnvironmentsBreakdown } from '../hooks/useEnvironmentsBreakdown';
import { useGrpcRequestActions } from '../hooks/useGrpcRequestActions';
import type { HotkeyAction } from '../hooks/useHotKey';
import { useHttpRequestActions } from '../hooks/useHttpRequestActions';
import { useRecentEnvironments } from '../hooks/useRecentEnvironments';
import { useRecentRequests } from '../hooks/useRecentRequests';
import { useRecentWorkspaces } from '../hooks/useRecentWorkspaces';
import { useScrollIntoView } from '../hooks/useScrollIntoView';
import { useSendAnyHttpRequest } from '../hooks/useSendAnyHttpRequest';
import { useSidebarHidden } from '../hooks/useSidebarHidden';
import { createRequestAndNavigate } from '../lib/createRequestAndNavigate';
import { deleteModelWithConfirm } from '../lib/deleteModelWithConfirm';
import { showDialog } from '../lib/dialog';
import { editEnvironment } from '../lib/editEnvironment';
import { renameModelWithPrompt } from '../lib/renameModelWithPrompt';
import { resolvedModelNameWithFolders } from '../lib/resolvedModelName';
import { router } from '../lib/router';
import { setWorkspaceSearchParams } from '../lib/setWorkspaceSearchParams';
import { CookieDialog } from './CookieDialog';
import { Button } from './core/Button';
import { Heading } from './core/Heading';
import { HotKey } from './core/HotKey';
import { HttpMethodTag } from './core/HttpMethodTag';
import { Icon } from './core/Icon';
import { PlainInput } from './core/PlainInput';
import { HStack } from './core/Stacks';

interface CommandPaletteGroup {
  key: string;
  label: ReactNode;
  items: CommandPaletteItem[];
}

type CommandPaletteItem = {
  key: string;
  onSelect: () => void;
  action?: HotkeyAction;
} & ({ searchText: string; label: ReactNode } | { label: string });

const MAX_PER_GROUP = 8;

export function CommandPaletteDialog({ onClose }: { onClose: () => void }) {
  const [command, setCommand] = useDebouncedState<string>('', 150);
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
  const activeEnvironment = useActiveEnvironment();
  const httpRequestActions = useHttpRequestActions();
  const grpcRequestActions = useGrpcRequestActions();
  const workspaceId = useAtomValue(activeWorkspaceIdAtom);
  const workspaces = useAtomValue(workspacesAtom);
  const { baseEnvironment, subEnvironments } = useEnvironmentsBreakdown();
  const createWorkspace = useCreateWorkspace();
  const recentEnvironments = useRecentEnvironments();
  const recentWorkspaces = useRecentWorkspaces();
  const requests = useAllRequests();
  const activeRequest = useActiveRequest();
  const activeCookieJar = useActiveCookieJar();
  const [recentRequests] = useRecentRequests();
  const [, setSidebarHidden] = useSidebarHidden();
  const { mutate: sendRequest } = useSendAnyHttpRequest();

  const workspaceCommands = useMemo<CommandPaletteItem[]>(() => {
    if (workspaceId == null) return [];

    const commands: CommandPaletteItem[] = [
      {
        key: 'settings.open',
        label: 'Open Settings',
        action: 'settings.show',
        onSelect: () => openSettings.mutate(null),
      },
      {
        key: 'app.create',
        label: 'Create Workspace',
        onSelect: createWorkspace,
      },
      {
        key: 'model.create',
        label: 'Create HTTP Request',
        onSelect: () => createRequestAndNavigate({ model: 'http_request', workspaceId }),
      },
      {
        key: 'grpc_request.create',
        label: 'Create GRPC Request',
        onSelect: () => createRequestAndNavigate({ model: 'grpc_request', workspaceId }),
      },
      {
        key: 'websocket_request.create',
        label: 'Create Websocket Request',
        onSelect: () => createRequestAndNavigate({ model: 'websocket_request', workspaceId }),
      },
      {
        key: 'folder.create',
        label: 'Create Folder',
        onSelect: () => createFolder.mutate({}),
      },
      {
        key: 'cookies.show',
        label: 'Show Cookies',
        onSelect: async () => {
          showDialog({
            id: 'cookies',
            title: 'Manage Cookies',
            size: 'full',
            render: () => <CookieDialog cookieJarId={activeCookieJar?.id ?? null} />,
          });
        },
      },
      {
        key: 'environment.edit',
        label: 'Edit Environment',
        action: 'environmentEditor.toggle',
        onSelect: () => editEnvironment(activeEnvironment),
      },
      {
        key: 'environment.create',
        label: 'Create Environment',
        onSelect: () => createSubEnvironmentAndActivate.mutate(baseEnvironment),
      },
      {
        key: 'sidebar.toggle',
        label: 'Toggle Sidebar',
        action: 'sidebar.focus',
        onSelect: () => setSidebarHidden((h) => !h),
      },
    ];

    if (activeRequest?.model === 'http_request') {
      commands.push({
        key: 'request.send',
        action: 'request.send',
        label: 'Send Request',
        onSelect: () => sendRequest(activeRequest.id),
      });
      for (let i = 0; i < httpRequestActions.length; i++) {
        const a = httpRequestActions[i]!;
        commands.push({
          key: `http_request_action.${i}`,
          label: a.label,
          onSelect: () => a.call(activeRequest),
        });
      }
    }

    if (activeRequest?.model === 'grpc_request') {
      for (let i = 0; i < grpcRequestActions.length; i++) {
        const a = grpcRequestActions[i]!;
        commands.push({
          key: `grpc_request_action.${i}`,
          label: a.label,
          onSelect: () => a.call(activeRequest),
        });
      }
    }

    if (activeRequest != null) {
      commands.push({
        key: 'http_request.rename',
        label: 'Rename Request',
        onSelect: () => renameModelWithPrompt(activeRequest),
      });

      commands.push({
        key: 'sidebar.delete_selected_item',
        label: 'Delete Request',
        onSelect: () => deleteModelWithConfirm(activeRequest),
      });
    }

    return commands.sort((a, b) =>
      ('searchText' in a ? a.searchText : a.label).localeCompare(
        'searchText' in b ? b.searchText : b.label,
      ),
    );
  }, [
    activeCookieJar?.id,
    activeEnvironment,
    activeRequest,
    baseEnvironment,
    createWorkspace,
    grpcRequestActions,
    httpRequestActions,
    sendRequest,
    setSidebarHidden,
    workspaceId,
  ]);

  const sortedRequests = useMemo(() => {
    return [...requests].sort((a, b) => {
      const aRecentIndex = recentRequests.indexOf(a.id);
      const bRecentIndex = recentRequests.indexOf(b.id);

      if (aRecentIndex >= 0 && bRecentIndex >= 0) {
        return aRecentIndex - bRecentIndex;
      } else if (aRecentIndex >= 0 && bRecentIndex === -1) {
        return -1;
      } else if (aRecentIndex === -1 && bRecentIndex >= 0) {
        return 1;
      } else {
        return a.createdAt.localeCompare(b.createdAt);
      }
    });
  }, [recentRequests, requests]);

  const sortedEnvironments = useMemo(() => {
    return [...subEnvironments].sort((a, b) => {
      const aRecentIndex = recentEnvironments.indexOf(a.id);
      const bRecentIndex = recentEnvironments.indexOf(b.id);

      if (aRecentIndex >= 0 && bRecentIndex >= 0) {
        return aRecentIndex - bRecentIndex;
      } else if (aRecentIndex >= 0 && bRecentIndex === -1) {
        return -1;
      } else if (aRecentIndex === -1 && bRecentIndex >= 0) {
        return 1;
      } else {
        return a.createdAt.localeCompare(b.createdAt);
      }
    });
  }, [subEnvironments, recentEnvironments]);

  const sortedWorkspaces = useMemo(() => {
    if (recentWorkspaces == null) {
      // Should never happen
      return workspaces;
    }

    return [...workspaces].sort((a, b) => {
      const aRecentIndex = recentWorkspaces?.indexOf(a.id);
      const bRecentIndex = recentWorkspaces?.indexOf(b.id);

      if (aRecentIndex >= 0 && bRecentIndex >= 0) {
        return aRecentIndex - bRecentIndex;
      } else if (aRecentIndex >= 0 && bRecentIndex === -1) {
        return -1;
      } else if (aRecentIndex === -1 && bRecentIndex >= 0) {
        return 1;
      } else {
        return a.createdAt.localeCompare(b.createdAt);
      }
    });
  }, [recentWorkspaces, workspaces]);

  const groups = useMemo<CommandPaletteGroup[]>(() => {
    const actionsGroup: CommandPaletteGroup = {
      key: 'actions',
      label: 'Actions',
      items: workspaceCommands,
    };

    const requestGroup: CommandPaletteGroup = {
      key: 'requests',
      label: 'Switch Request',
      items: [],
    };

    for (const r of sortedRequests) {
      requestGroup.items.push({
        key: `switch-request-${r.id}`,
        searchText: resolvedModelNameWithFolders(r),
        label: (
          <HStack space={2}>
            <HttpMethodTag short className="text-xs" request={r} />
            <div className="truncate">{resolvedModelNameWithFolders(r)}</div>
          </HStack>
        ),
        onSelect: async () => {
          await router.navigate({
            to: '/workspaces/$workspaceId',
            params: { workspaceId: r.workspaceId },
            search: (prev) => ({ ...prev, request_id: r.id }),
          });
        },
      });
    }

    const environmentGroup: CommandPaletteGroup = {
      key: 'environments',
      label: 'Switch Environment',
      items: [],
    };

    for (const e of sortedEnvironments) {
      if (e.id === activeEnvironment?.id) {
        continue;
      }
      environmentGroup.items.push({
        key: `switch-environment-${e.id}`,
        label: e.name,
        onSelect: () => setWorkspaceSearchParams({ environment_id: e.id }),
      });
    }

    const workspaceGroup: CommandPaletteGroup = {
      key: 'workspaces',
      label: 'Switch Workspace',
      items: [],
    };

    for (const w of sortedWorkspaces) {
      workspaceGroup.items.push({
        key: `switch-workspace-${w.id}`,
        label: w.name,
        onSelect: () => switchWorkspace.mutate({ workspaceId: w.id, inNewWindow: false }),
      });
    }

    return [actionsGroup, requestGroup, environmentGroup, workspaceGroup];
  }, [
    workspaceCommands,
    sortedRequests,
    sortedEnvironments,
    activeEnvironment?.id,
    sortedWorkspaces,
  ]);

  const allItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => {
    setSelectedItemKey(null);
  }, [command]);

  const { filteredGroups, filteredAllItems } = useMemo(() => {
    const result = command
      ? fuzzyFilter(
          allItems.map((i) => ({
            ...i,
            filterBy: 'searchText' in i ? i.searchText : i.label,
          })),
          command,
          { fields: ['filterBy'] },
        )
          .sort((a, b) => b.score - a.score)
          .map((v) => v.item)
      : allItems;

    const filteredGroups = groups
      .map((g) => {
        const items = result
          .filter((i) => g.items.find((i2) => i2.key === i.key))
          .slice(0, MAX_PER_GROUP);
        return { ...g, items };
      })
      .filter((g) => g.items.length > 0);

    const filteredAllItems = filteredGroups.flatMap((g) => g.items);
    return { filteredAllItems, filteredGroups };
  }, [allItems, command, groups]);

  const handleSelectAndClose = useCallback(
    (cb: () => void) => {
      onClose();
      cb();
    },
    [onClose],
  );

  const selectedItem = useMemo(() => {
    let selectedItem = filteredAllItems.find((i) => i.key === selectedItemKey) ?? null;
    if (selectedItem == null) {
      selectedItem = filteredAllItems[0] ?? null;
    }
    return selectedItem;
  }, [filteredAllItems, selectedItemKey]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      const index = filteredAllItems.findIndex((v) => v.key === selectedItem?.key);
      if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
        const next = filteredAllItems[index + 1] ?? filteredAllItems[0];
        setSelectedItemKey(next?.key ?? null);
      } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'k')) {
        const prev = filteredAllItems[index - 1] ?? filteredAllItems[filteredAllItems.length - 1];
        setSelectedItemKey(prev?.key ?? null);
      } else if (e.key === 'Enter') {
        const selected = filteredAllItems[index];
        setSelectedItemKey(selected?.key ?? null);
        if (selected) {
          handleSelectAndClose(selected.onSelect);
        }
      }
    },
    [filteredAllItems, handleSelectAndClose, selectedItem?.key],
  );

  return (
    <div className="h-full w-[400px] grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden py-2">
      <div className="px-2 w-full">
        <PlainInput
          hideLabel
          leftSlot={
            <div className="h-md w-10 flex justify-center items-center">
              <Icon icon="search" color="secondary" />
            </div>
          }
          name="command"
          label="Command"
          placeholder="Search or type a command"
          className="font-sans !text-base"
          defaultValue={command}
          onChange={setCommand}
          onKeyDownCapture={handleKeyDown}
        />
      </div>
      <div className="h-full px-1.5 overflow-y-auto pt-2 pb-1">
        {filteredGroups.map((g) => (
          <div key={g.key} className="mb-1.5 w-full">
            <Heading level={2} className="!text-xs uppercase px-1.5 h-sm flex items-center">
              {g.label}
            </Heading>
            {g.items.map((v) => (
              <CommandPaletteItem
                active={v.key === selectedItem?.key}
                key={v.key}
                onClick={() => handleSelectAndClose(v.onSelect)}
                rightSlot={v.action && <CommandPaletteAction action={v.action} />}
              >
                {v.label}
              </CommandPaletteItem>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function CommandPaletteItem({
  children,
  active,
  onClick,
  rightSlot,
}: {
  children: ReactNode;
  active: boolean;
  onClick: () => void;
  rightSlot?: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useScrollIntoView(ref.current, active);

  return (
    <Button
      ref={ref}
      onClick={onClick}
      tabIndex={active ? undefined : -1}
      rightSlot={rightSlot}
      color="custom"
      justify="start"
      className={classNames(
        'w-full h-sm flex items-center rounded px-1.5',
        'hover:text-text',
        active && 'bg-surface-highlight',
        !active && 'text-text-subtle',
      )}
    >
      <span className="truncate">{children}</span>
    </Button>
  );
}

function CommandPaletteAction({ action }: { action: HotkeyAction }) {
  return <HotKey className="ml-auto" action={action} />;
}
