import type { CallWorkspaceActionArgs, WorkspaceAction } from '../bindings/gen_events';
import type { Context } from './Context';

export type WorkspaceActionPlugin = WorkspaceAction & {
  onSelect(ctx: Context, args: CallWorkspaceActionArgs): Promise<void> | void;
};
