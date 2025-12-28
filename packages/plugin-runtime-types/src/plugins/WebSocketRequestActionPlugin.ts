import type { CallWebSocketRequestActionArgs, WebSocketRequestAction } from '../bindings/gen_events';
import type { Context } from './Context';

export type WebSocketRequestActionPlugin = WebSocketRequestAction & {
  onSelect(ctx: Context, args: CallWebSocketRequestActionArgs): Promise<void> | void;
};
