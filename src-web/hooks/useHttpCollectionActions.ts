import { useQuery } from '@tanstack/react-query';
import type { Folder, Workspace } from '@yaakapp-internal/models';
import type {
  CallHttpCollectionActionRequest,
  GetHttpCollectionActionsResponse,
  HttpCollectionAction,
} from '@yaakapp-internal/plugins';
import { useMemo } from 'react';
import { invokeCmd } from '../lib/tauri';
import { usePluginsKey } from './usePlugins';

export type CallableHttpCollectionAction = Pick<HttpCollectionAction, 'label' | 'icon'> & {
  call: (model: Folder | Workspace) => Promise<void>;
};

export function useHttpCollectionActions() {
  const pluginsKey = usePluginsKey();

  const actionsResult = useQuery<CallableHttpCollectionAction[]>({
    queryKey: ['http_collection_actions', pluginsKey],
    queryFn: () => getHttpCollectionActions(),
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: none
  const actions = useMemo(() => {
    return actionsResult.data ?? [];
  }, [JSON.stringify(actionsResult.data)]);

  return actions;
}

export async function getHttpCollectionActions() {
  const responses = await invokeCmd<GetHttpCollectionActionsResponse[]>('cmd_http_collection_actions');
  const actions = responses.flatMap((r) =>
    r.actions.map((a, i) => ({
      label: a.label,
      icon: a.icon,
      call: async (model: Folder | Workspace) => {
        const payload: CallHttpCollectionActionRequest = {
          index: i,
          pluginRefId: r.pluginRefId,
          args: (model as any).model === 'folder' ? { folder: model as Folder } : { workspace: model as Workspace },
        } as any;
        await invokeCmd('cmd_call_http_collection_action', { req: payload });
      },
    })),
  );

  return actions;
}
