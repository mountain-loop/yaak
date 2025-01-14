import type { Context } from './Context';

export type FilterPluginResponse = string[];

export type FilterPlugin = {
  name: string;
  description?: string;
  canFilter(ctx: Context, args: { mimeType: string }): Promise<boolean>;
  onFilter(
    ctx: Context,
    args: { payload: string; mimeType: string },
  ): Promise<FilterPluginResponse>;
};
