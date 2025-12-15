import type { Context } from './Context';
import type { Folder, Workspace } from '../bindings/gen_models';
import type { Icon } from '../bindings/gen_events';

export type HttpCollectionAction = { label: string; icon?: Icon };

export type CallHttpCollectionActionArgs = { folder?: Folder; workspace?: Workspace };

export type HttpCollectionActionPlugin = HttpCollectionAction & {
  onSelect(ctx: Context, args: CallHttpCollectionActionArgs): Promise<void> | void;
};
