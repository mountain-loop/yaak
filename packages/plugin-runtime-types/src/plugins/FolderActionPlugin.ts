import type { Context } from './Context';
import type { Folder } from '../bindings/gen_models';
import type { Icon } from '../bindings/gen_events';

export type FolderAction = { label: string; icon?: Icon };

export type CallFolderActionArgs = { folder: Folder };

export type FolderActionPlugin = FolderAction & {
  onSelect(ctx: Context, args: CallFolderActionArgs): Promise<void> | void;
};
