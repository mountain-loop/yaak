import type { CallGrpcRequestActionArgs, GrpcRequestAction } from '../bindings/gen_events';
import type { Context } from './Context';

export type GrpcRequestActionPlugin = GrpcRequestAction & {
  onSelect(ctx: Context, args: CallGrpcRequestActionArgs): Promise<void> | void;
};
