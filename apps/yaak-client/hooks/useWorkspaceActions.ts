import { useQuery } from "@tanstack/react-query";
import type { Workspace } from "@yaakapp-internal/models";
import type {
  CallWorkspaceActionRequest,
  GetWorkspaceActionsResponse,
  WorkspaceAction,
} from "@yaakapp-internal/plugins";
import { useMemo } from "react";
import { rpc } from "../lib/rpc";
import { usePluginsKey } from "./usePlugins";

export type CallableWorkspaceAction = Pick<WorkspaceAction, "label" | "icon"> & {
  call: (workspace: Workspace) => Promise<void>;
};

export function useWorkspaceActions() {
  const pluginsKey = usePluginsKey();

  const actionsResult = useQuery<CallableWorkspaceAction[]>({
    queryKey: ["workspace_actions", pluginsKey],
    queryFn: () => getWorkspaceActions(),
  });

  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const actions = useMemo(() => {
    return actionsResult.data ?? [];
  }, [JSON.stringify(actionsResult.data)]);

  return actions;
}

export async function getWorkspaceActions() {
  const responses = await rpc<GetWorkspaceActionsResponse[]>("cmd_workspace_actions");
  const actions = responses.flatMap((r) =>
    r.actions.map((a, i) => ({
      label: a.label,
      icon: a.icon,
      call: async (workspace: Workspace) => {
        const payload: CallWorkspaceActionRequest = {
          index: i,
          pluginRefId: r.pluginRefId,
          args: { workspace },
        };
        await rpc("cmd_call_workspace_action", { req: payload });
      },
    })),
  );

  return actions;
}
