import type { CallWebsocketRequestActionArgs, WebsocketRequestAction } from '../bindings/gen_events';
import type { Context } from './Context';

export type WebsocketRequestActionPlugin = WebsocketRequestAction & {
  onSelect(ctx: Context, args: CallWebsocketRequestActionArgs): Promise<void> | void;
};
