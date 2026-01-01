import type { FilterResponse } from '../bindings/gen_events';
import type { Context } from './Context';

export type FilterPlugin = {
  name: string;
  description?: string;
  onFilter(
    ctx: Context,
    args: { payload: string; filter: string; mimeType: string },
  ): Promise<FilterResponse> | FilterResponse;
};
