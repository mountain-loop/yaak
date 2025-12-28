import type { Context } from './Context';
import type { Workspace } from '../bindings/gen_models';
import type { Icon } from '../bindings/gen_events';

export type WorkspaceAction = { label: string; icon?: Icon };

export type CallWorkspaceActionArgs = { workspace: Workspace };

export type WorkspaceActionPlugin = WorkspaceAction & {
  onSelect(ctx: Context, args: CallWorkspaceActionArgs): Promise<void> | void;
};
