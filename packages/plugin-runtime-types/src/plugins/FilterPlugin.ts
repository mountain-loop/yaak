import type { Context } from './Context';

type FilterPluginResponse = { filtered: string };

export type FilterPlugin = {
  name: string;
  description?: string;
  onFilter(
    ctx: Context,
    args: { payload: string; filter: string; mimeType: string },
  ): Promise<FilterPluginResponse> | FilterPluginResponse;
};
