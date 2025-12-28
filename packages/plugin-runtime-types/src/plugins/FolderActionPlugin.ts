import type { CallFolderActionArgs, FolderAction } from '../bindings/gen_events';
import type { Context } from './Context';

export type FolderActionPlugin = FolderAction & {
  onSelect(ctx: Context, args: CallFolderActionArgs): Promise<void> | void;
};
