import { useEffect, useState } from "react";
import type {
  ActionInvocation,
  ActionMetadata,
} from "@yaakapp-internal/proxy-lib";
import { rpc } from "./rpc";

let cachedActions: [ActionInvocation, ActionMetadata][] | null = null;

/** Fetch and cache all action metadata. */
async function getActions(): Promise<[ActionInvocation, ActionMetadata][]> {
  if (!cachedActions) {
    const { actions } = await rpc("list_actions", {});
    cachedActions = actions;
  }
  return cachedActions;
}

/** Look up metadata for a specific action invocation. */
export function useActionMetadata(
  action: ActionInvocation,
): ActionMetadata | null {
  const [meta, setMeta] = useState<ActionMetadata | null>(null);

  useEffect(() => {
    getActions().then((actions) => {
      const match = actions.find(
        ([inv]) => inv.scope === action.scope && inv.action === action.action,
      );
      setMeta(match?.[1] ?? null);
    });
  }, [action]);

  return meta;
}
