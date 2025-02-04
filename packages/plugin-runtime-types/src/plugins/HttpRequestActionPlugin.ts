import type { CallHttpRequestActionArgs, HttpRequestAction } from '../bindings/gen_events';
import type { Context } from './Context';

export type HttpRequestActionPlugin = HttpRequestAction & {
  onSelect(ctx: Context, args: CallHttpRequestActionArgs): Promise<void> | void;
};
